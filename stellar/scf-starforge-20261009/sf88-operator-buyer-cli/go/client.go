// Package buyer connects Go applications to the original SF88 Node buyer.
//
// Durable intent, native approval, payment attempts, delivered bytes and recovery
// remain in that selected runtime. A Client can reopen its existing Node state.
package buyer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const callSchema = "stellar-forge.go-buyer-call.v1"
const maxCallBytes = 32 << 20

// Options selects the installed original runtime and the application's private state.
// ApprovalInput is an actual file descriptor (usually os.Stdin) for the original
// native terminal. Nil leaves it closed. The SDK never supplies approval answers.
type Options struct {
	RuntimeDirectory  string
	StateDirectory    string
	BridgePath        string
	Node              string
	OperatorProfile   string
	Environment       []string
	ApprovalInput     *os.File
	NativeTimeout     time.Duration
	CleanupGrace      time.Duration
	NativeOutputLimit int
	ResultLimit       int
}

type Client struct {
	options Options
}

type CallError struct {
	Code                string
	Action              string
	ID                  string
	InvocationDirectory string
	Native              json.RawMessage
	Cause               error
}

func (e *CallError) Error() string {
	return fmt.Sprintf("%s (action=%s, id=%s, invocation=%s)", e.Code, e.Action, e.ID, e.InvocationDirectory)
}
func (e *CallError) Unwrap() error { return e.Cause }

// New selects a local Node executable and the exact installed original SDK.
// It does not start Node, allocate an intent, discover a seller or execute a request.
func New(options Options) (*Client, error) {
	for _, path := range []string{options.RuntimeDirectory, options.StateDirectory} {
		if !filepath.IsAbs(path) {
			return nil, errors.New("absolute runtime and state directories are required")
		}
	}
	options.RuntimeDirectory = filepath.Clean(options.RuntimeDirectory)
	options.StateDirectory = filepath.Clean(options.StateDirectory)
	if options.BridgePath == "" {
		options.BridgePath = filepath.Join(options.RuntimeDirectory, "go", "bridge.mjs")
	}
	if !filepath.IsAbs(options.BridgePath) {
		return nil, errors.New("absolute bridge path is required")
	}
	options.BridgePath = filepath.Clean(options.BridgePath)
	if options.OperatorProfile != "" && !filepath.IsAbs(options.OperatorProfile) {
		return nil, errors.New("absolute operator profile path is required")
	}
	if options.Node == "" {
		options.Node = "node"
	}
	node, err := exec.LookPath(options.Node)
	if err != nil {
		return nil, fmt.Errorf("find Node executable: %w", err)
	}
	options.Node, err = filepath.Abs(node)
	if err != nil {
		return nil, err
	}
	for _, path := range []string{options.BridgePath, filepath.Join(options.RuntimeDirectory, "node", "index.mjs")} {
		st, err := os.Stat(path)
		if err != nil {
			return nil, err
		}
		if !st.Mode().IsRegular() {
			return nil, fmt.Errorf("regular runtime file required: %s", path)
		}
	}
	if options.NativeTimeout == 0 {
		options.NativeTimeout = 6 * time.Minute
	}
	if options.CleanupGrace == 0 {
		options.CleanupGrace = 15 * time.Second
	}
	if options.NativeOutputLimit == 0 {
		options.NativeOutputLimit = 1 << 20
	}
	if options.ResultLimit == 0 {
		options.ResultLimit = 64 << 20
	}
	if options.NativeTimeout < time.Millisecond || options.NativeTimeout.Milliseconds() > 2147483647 ||
		options.CleanupGrace < time.Millisecond || options.CleanupGrace.Milliseconds() > 2147483647 ||
		options.NativeOutputLimit < 1 || options.NativeOutputLimit > 268435456 ||
		options.ResultLimit < 1 || options.ResultLimit > 268435456 {
		return nil, errors.New("buyer runtime limits are outside supported ranges")
	}
	if options.Environment != nil {
		options.Environment = append([]string{}, options.Environment...)
	}
	return &Client{options: options}, nil
}

func privateDirectory(path string) error {
	if err := os.MkdirAll(path, 0700); err != nil {
		return err
	}
	st, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !st.IsDir() || st.Mode().Perm()&0077 != 0 {
		return fmt.Errorf("private directory required: %s", path)
	}
	return nil
}

func writePrivate(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}

type envelope struct {
	Schema    string         `json:"schema"`
	CallID    string         `json:"callId"`
	Action    string         `json:"action"`
	ID        string         `json:"id,omitempty"`
	Client    map[string]any `json:"client"`
	Arguments any            `json:"arguments"`
}
type response struct {
	Schema string          `json:"schema"`
	CallID string          `json:"callId"`
	Action string          `json:"action"`
	ID     *string         `json:"id"`
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result"`
	Error  json.RawMessage `json:"error"`
}

func readResponse(path string, limit int) (*response, error) {
	st, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 || st.Size() > int64(limit) {
		return nil, errors.New("private bridge response or response size is invalid")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, int64(limit)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > limit {
		return nil, errors.New("bridge response size limit exceeded")
	}
	var value response
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return &value, nil
}

// invoke owns only a transient IPC directory. The original Node state and native
// command logs remain authoritative. Failed calls retain their private diagnostics.
func (c *Client) invoke(ctx context.Context, action, id string, args any, consume func(io.Reader) error) (json.RawMessage, error) {
	if ctx == nil {
		return nil, errors.New("context is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := privateDirectory(c.options.StateDirectory); err != nil {
		return nil, err
	}
	calls := filepath.Join(c.options.StateDirectory, ".go-calls")
	if err := privateDirectory(calls); err != nil {
		return nil, err
	}
	directory, err := os.MkdirTemp(calls, "call-")
	if err != nil {
		return nil, err
	}
	callID := filepath.Base(directory)
	fail := func(code string, cause error, native json.RawMessage) error {
		return &CallError{Code: code, Action: action, ID: id,
			InvocationDirectory: directory, Native: native, Cause: cause}
	}
	settings := map[string]any{
		"runtimeDirectory": c.options.RuntimeDirectory, "stateDirectory": c.options.StateDirectory,
		"timeoutMs": c.options.NativeTimeout.Milliseconds(), "cleanupGraceMs": c.options.CleanupGrace.Milliseconds(),
		"outputLimit": c.options.NativeOutputLimit,
	}
	if c.options.OperatorProfile != "" {
		settings["operatorProfile"] = c.options.OperatorProfile
	}
	if args == nil {
		args = map[string]any{}
	}
	data, err := json.Marshal(envelope{Schema: callSchema, CallID: callID, Action: action, ID: id, Client: settings, Arguments: args})
	if err != nil {
		return nil, fail("GO_CALL_ENCODING_FAILED", err, nil)
	}
	if len(data) > maxCallBytes {
		return nil, fail("GO_CALL_SIZE_LIMIT", nil, nil)
	}
	requestPath := filepath.Join(directory, "request.json")
	if err := writePrivate(requestPath, data); err != nil {
		return nil, fail("GO_CALL_WRITE_FAILED", err, nil)
	}
	log, err := os.OpenFile(filepath.Join(directory, "bridge.stderr.log"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, fail("GO_LOG_OPEN_FAILED", err, nil)
	}
	defer log.Close()

	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(runCtx, c.options.Node, c.options.BridgePath, requestPath)
	cmd.Dir = c.options.RuntimeDirectory
	cmd.Env = c.options.Environment
	cmd.Stdin = c.options.ApprovalInput
	cmd.Stderr = log
	// Interrupt reaches the adapter's AbortSignal; the original native runtime
	// then owns child drain. WaitDelay covers its configured cleanup plus handoff.
	cmd.Cancel = func() error { return cmd.Process.Signal(os.Interrupt) }
	cmd.WaitDelay = c.options.CleanupGrace + 5*time.Second
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fail("GO_OUTPUT_PIPE_FAILED", err, nil)
	}
	if err := cmd.Start(); err != nil {
		stdout.Close()
		return nil, fail("GO_BRIDGE_START_FAILED", err, nil)
	}
	var readErr error
	if consume == nil {
		var n int64
		n, readErr = io.Copy(io.Discard, stdout)
		if readErr == nil && n != 0 {
			readErr = errors.New("unexpected bridge output")
		}
	} else {
		readErr = consume(stdout)
	}
	if readErr != nil {
		cancel()
		stdout.Close()
	}
	waitErr := cmd.Wait()
	log.Sync()
	value, responseErr := readResponse(filepath.Join(directory, "response.json"), c.options.ResultLimit)
	if responseErr != nil {
		cause := responseErr
		if ctx.Err() != nil {
			cause = ctx.Err()
		} else if readErr != nil {
			cause = readErr
		}
		return nil, fail("GO_BRIDGE_RESULT_UNAVAILABLE", cause, nil)
	}
	identityMatches := (id == "" && value.ID == nil) || (value.ID != nil && *value.ID == id)
	if value.Schema != callSchema || value.CallID != callID || value.Action != action || !identityMatches {
		return nil, fail("GO_BRIDGE_RESPONSE_MISMATCH", nil, value.Error)
	}
	if readErr != nil {
		return value.Result, fail("GO_OUTPUT_CONSUMER_FAILED", readErr, value.Error)
	}
	if !value.OK {
		var native struct {
			Code string `json:"code"`
		}
		json.Unmarshal(value.Error, &native)
		if native.Code == "" {
			native.Code = "GO_BRIDGE_OPERATION_FAILED"
		}
		return value.Result, fail(native.Code, ctx.Err(), value.Error)
	}
	if ctx.Err() != nil {
		return value.Result, fail("GO_CONTEXT_CANCELLED", ctx.Err(), nil)
	}
	if waitErr != nil {
		return value.Result, fail("GO_BRIDGE_PROCESS_FAILED", waitErr, nil)
	}
	log.Close()
	if err := os.RemoveAll(directory); err != nil {
		return value.Result, fail("GO_CALL_CLEANUP_FAILED", err, nil)
	}
	return value.Result, nil
}

func decode[T any](raw json.RawMessage, callErr error) (*T, error) {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, callErr
	}
	var value T
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, errors.Join(callErr, fmt.Errorf("decode original buyer response: %w", err))
	}
	return &value, callErr
}

func (c *Client) Ready(ctx context.Context) (json.RawMessage, error) {
	return c.invoke(ctx, "buyer.ready", "", nil, nil)
}

type OperationInfo struct {
	IntentID  string `json:"intentId"`
	Directory string `json:"directory"`
}

func (c *Client) List(ctx context.Context) ([]OperationInfo, error) {
	raw, err := c.invoke(ctx, "buyer.list", "", nil, nil)
	value, err := decode[[]OperationInfo](raw, err)
	if value == nil {
		return nil, err
	}
	return *value, err
}

// CreateOptions carries only options understood by the original Node application.
// Body nil preserves an absent body; a non-nil zero-length slice is an empty body.
type CreateOptions struct {
	Body            []byte
	ResponseFile    json.RawMessage
	RequestTimeout  time.Duration
	OperatorProfile string
}

func (o CreateOptions) payload() map[string]any {
	out := map[string]any{}
	if o.Body != nil {
		out["bodyBase64"] = encodeBody(o.Body)
	}
	if len(o.ResponseFile) != 0 {
		out["responseFile"] = o.ResponseFile
	}
	if o.RequestTimeout != 0 {
		out["requestTimeoutMs"] = o.RequestTimeout.Milliseconds()
	}
	if o.OperatorProfile != "" {
		out["operatorProfile"] = o.OperatorProfile
	}
	return out
}

type Request struct {
	IntentID       string            `json:"intentId"`
	URL            string            `json:"url"`
	Method         string            `json:"method,omitempty"`
	Expect         json.RawMessage   `json:"expect,omitempty"`
	Headers        map[string]string `json:"headers,omitempty"`
	OrderReference string            `json:"orderReference,omitempty"`
	TicketFile     string            `json:"ticketFile,omitempty"`
	TicketHeader   string            `json:"ticketHeader,omitempty"`
}

func (c *Client) created(ctx context.Context, action string, args any) (*Operation, error) {
	raw, err := c.invoke(ctx, action, "", args, nil)
	info, err := decode[OperationInfo](raw, err)
	if info == nil {
		return nil, err
	}
	return c.Operation(info.IntentID), err
}
func (c *Client) Create(ctx context.Context, config json.RawMessage, options CreateOptions) (*Operation, error) {
	return c.created(ctx, "buyer.create", map[string]any{"config": config, "options": options.payload()})
}
func (c *Client) CreateFromFile(ctx context.Context, configFile string, options CreateOptions) (*Operation, error) {
	return c.created(ctx, "buyer.create", map[string]any{"configFile": configFile, "options": options.payload()})
}
func (c *Client) CreateRequest(ctx context.Context, request Request, options CreateOptions) (*Operation, error) {
	return c.created(ctx, "buyer.request", map[string]any{"request": request, "options": options.payload()})
}
func (c *Client) ImportOperation(ctx context.Context, file string, accept int, options CreateOptions) (*Operation, error) {
	values := options.payload()
	if options.Body != nil {
		return nil, errors.New("operation handoff carries its original body")
	}
	values["accept"] = accept
	return c.created(ctx, "buyer.import", map[string]any{"file": file, "options": values})
}
func (c *Client) Discover(ctx context.Context, catalog json.RawMessage, destination string) (json.RawMessage, error) {
	args := map[string]any{"catalog": catalog}
	if destination != "" {
		args["destination"] = destination
	}
	return c.invoke(ctx, "buyer.discover", "", args, nil)
}

// Prepare retains the original explicit catalog row and payment-option selection.
func (c *Client) Prepare(ctx context.Context, options json.RawMessage) (*Operation, error) {
	return c.created(ctx, "buyer.prepare", options)
}

// Operation is an address in the original Node application's durable state.
type Operation struct {
	client   *Client
	IntentID string
}

func (c *Client) Operation(intentID string) *Operation {
	return &Operation{client: c, IntentID: intentID}
}

type OperationState struct {
	IntentID          string  `json:"intentId"`
	Directory         string  `json:"directory"`
	State             string  `json:"state"`
	ResultRecoverable bool    `json:"resultRecoverable"`
	NativeStatus      *string `json:"nativeStatus"`
	DeliveryStatus    *string `json:"deliveryStatus"`
	InboxDirectory    string  `json:"inboxDirectory,omitempty"`
	Retry             string  `json:"retry"`
}
type Result struct {
	Record   json.RawMessage `json:"record"`
	Native   json.RawMessage `json:"native"`
	Status   string          `json:"status"`
	Delivery json.RawMessage `json:"delivery"`
	Stream   json.RawMessage `json:"stream"`
	OK       bool            `json:"ok"`
}

func (o *Operation) Review(ctx context.Context) (json.RawMessage, error) {
	return o.client.invoke(ctx, "operation.review", o.IntentID, nil, nil)
}
func (o *Operation) Inspect(ctx context.Context) (*OperationState, error) {
	raw, err := o.client.invoke(ctx, "operation.inspect", o.IntentID, nil, nil)
	return decode[OperationState](raw, err)
}
func (o *Operation) Execute(ctx context.Context, review json.RawMessage) (*Result, error) {
	raw, err := o.client.invoke(ctx, "operation.execute", o.IntentID, map[string]any{"review": review}, nil)
	return decode[Result](raw, err)
}

// Recover only reopens the original result or completed native stdout. A nil
// result means no complete outcome is available; it never restarts the purchase.
func (o *Operation) Recover(ctx context.Context) (*Result, error) {
	raw, err := o.client.invoke(ctx, "operation.recover", o.IntentID, nil, nil)
	return decode[Result](raw, err)
}
func (o *Operation) File() *File {
	return &File{client: o.client, selection: map[string]any{"kind": "operation", "id": o.IntentID}}
}
