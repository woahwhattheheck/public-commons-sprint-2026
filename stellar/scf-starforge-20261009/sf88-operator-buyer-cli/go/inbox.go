package buyer

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
)

// Inbox addresses the original exact-intent native inbox.
type Inbox struct {
	client    *Client
	Directory string
}

type InboxProgress struct {
	Native           json.RawMessage `json:"native"`
	Process          ProcessOutcome  `json:"process"`
	CommandDirectory *string         `json:"commandDirectory"`
}

type InboxResponse struct {
	Job      json.RawMessage `json:"job"`
	Native   json.RawMessage `json:"native"`
	Status   string          `json:"status"`
	Delivery json.RawMessage `json:"delivery"`
	Stream   json.RawMessage `json:"stream"`
}

func (c *Client) Inbox(directory string) (*Inbox, error) {
	if !filepath.IsAbs(directory) {
		return nil, errors.New("absolute inbox directory is required")
	}
	return &Inbox{client: c, Directory: filepath.Clean(directory)}, nil
}

func (c *Client) CreateInbox(ctx context.Context, directory string) (*Inbox, error) {
	inbox, err := c.Inbox(directory)
	if err != nil {
		return nil, err
	}
	_, err = c.invoke(ctx, "buyer.create-inbox", "", map[string]any{"directory": inbox.Directory}, nil)
	if err != nil {
		return nil, err
	}
	return inbox, nil
}

// InspectOperationHandoff reads the original merchant packet. An optional accept
// index selects one explicit native payment choice.
func (c *Client) InspectOperationHandoff(ctx context.Context, file string, accept *int) (json.RawMessage, error) {
	args := map[string]any{"file": file}
	if accept != nil {
		args["options"] = map[string]any{"accept": *accept}
	}
	return c.invoke(ctx, "buyer.inspect-handoff", "", args, nil)
}

func (i *Inbox) invoke(ctx context.Context, action, intentID string, args map[string]any) (json.RawMessage, error) {
	if args == nil {
		args = map[string]any{}
	}
	args["directory"] = i.Directory
	return i.client.invoke(ctx, action, intentID, args, nil)
}
func (i *Inbox) command(ctx context.Context, action, intentID string, args map[string]any) (*InboxProgress, error) {
	raw, err := i.invoke(ctx, action, intentID, args)
	return decode[InboxProgress](raw, err)
}
func (i *Inbox) List(ctx context.Context) (*InboxProgress, error) {
	return i.command(ctx, "inbox.list", "", nil)
}
func (i *Inbox) Show(ctx context.Context, intentID string) (*InboxProgress, error) {
	return i.command(ctx, "inbox.show", intentID, nil)
}

// Enqueue delegates an operation owned by this same buyer to the original inbox.
func (i *Inbox) Enqueue(ctx context.Context, operation *Operation) (*InboxProgress, error) {
	if operation == nil || operation.client != i.client {
		return nil, errors.New("operation must belong to this inbox's buyer")
	}
	return i.command(ctx, "inbox.enqueue", operation.IntentID, nil)
}
func (i *Inbox) EnqueueConfig(ctx context.Context, configFile string) (*InboxProgress, error) {
	return i.command(ctx, "inbox.enqueue-config", "", map[string]any{"configFile": configFile})
}
func (i *Inbox) Review(ctx context.Context, intentID string) (json.RawMessage, error) {
	return i.invoke(ctx, "inbox.review", intentID, nil)
}
func (i *Inbox) Execute(ctx context.Context, intentID string, review json.RawMessage, workspaceDirectory string) (*InboxProgress, error) {
	options := map[string]any{"review": review}
	if workspaceDirectory != "" {
		options["workspaceDirectory"] = workspaceDirectory
	}
	return i.command(ctx, "inbox.execute", intentID, map[string]any{"options": options})
}
func (i *Inbox) Cancel(ctx context.Context, intentID string) (*InboxProgress, error) {
	return i.command(ctx, "inbox.cancel", intentID, nil)
}
func (i *Inbox) Recover(ctx context.Context, intentID string) (*InboxProgress, error) {
	return i.command(ctx, "inbox.recover", intentID, nil)
}

// Finalize takes the original workspaceDirectory, outboxDirectory and merchantRoute.
func (i *Inbox) Finalize(ctx context.Context, intentID string, options json.RawMessage) (*InboxProgress, error) {
	return i.command(ctx, "inbox.finalize", intentID, map[string]any{"options": options})
}
func (i *Inbox) ExportReport(ctx context.Context, destination, workspaceDirectory string) (*InboxProgress, error) {
	args := map[string]any{"destination": destination}
	if workspaceDirectory != "" {
		args["options"] = map[string]any{"workspaceDirectory": workspaceDirectory}
	}
	return i.command(ctx, "inbox.report", "", args)
}
func (i *Inbox) Response(ctx context.Context, intentID string) (*InboxResponse, error) {
	raw, err := i.invoke(ctx, "inbox.response", intentID, nil)
	return decode[InboxResponse](raw, err)
}
func (i *Inbox) File(intentID string) *File {
	return &File{client: i.client, selection: map[string]any{
		"kind": "inbox", "directory": i.Directory, "id": intentID}}
}

// Response reopens an original public BuyerResult record and its response-file
// configuration through the selected runtime's exported verified reader.
func (c *Client) Response(record, responseFile json.RawMessage) *File {
	return &File{client: c, selection: map[string]any{
		"kind": "response", "record": record, "responseFile": responseFile}}
}
