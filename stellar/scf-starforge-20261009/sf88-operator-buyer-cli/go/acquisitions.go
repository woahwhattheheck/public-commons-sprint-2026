package buyer

import (
	"context"
	"encoding/json"
	"errors"
)

type ProcessOutcome struct {
	ExitCode   *int    `json:"exitCode"`
	ExitSignal *string `json:"exitSignal"`
	ErrorCode  *string `json:"errorCode"`
}
type PageOptions struct {
	ChunkOffset int `json:"chunkOffset,omitempty"`
	ChunkLimit  int `json:"chunkLimit,omitempty"`
}
type AcquisitionInfo struct {
	ID        string `json:"id"`
	Directory string `json:"directory"`
}
type ObjectOptions struct {
	ID                  string
	Config              json.RawMessage
	ConfigFile          string
	WorkspaceDirectory  string
	OperatorProfile     string
	DescriptionFile     string
	ObjectID            string
	MaxTotalAtomic      string
	Bytes               *int64
	ChunkBytes          *int64
	ExpectedSnapshot    string
	ExpectedSHA256      string
	ExpectedContentType string
}

func (o ObjectOptions) payload() map[string]any {
	out := map[string]any{"id": o.ID, "maxTotalAtomic": o.MaxTotalAtomic}
	if len(o.Config) != 0 {
		out["config"] = o.Config
	}
	if o.ConfigFile != "" {
		out["config"] = o.ConfigFile
	}
	if o.WorkspaceDirectory != "" {
		out["workspaceDirectory"] = o.WorkspaceDirectory
	}
	if o.OperatorProfile != "" {
		out["operatorProfile"] = o.OperatorProfile
	}
	if o.DescriptionFile != "" {
		out["descriptionFile"] = o.DescriptionFile
	}
	if o.ObjectID != "" {
		out["objectId"] = o.ObjectID
	}
	if o.Bytes != nil {
		out["bytes"] = *o.Bytes
	}
	if o.ChunkBytes != nil {
		out["chunkBytes"] = *o.ChunkBytes
	}
	if o.ExpectedSnapshot != "" {
		out["expectedSnapshot"] = o.ExpectedSnapshot
	}
	if o.ExpectedSHA256 != "" {
		out["expectedSha256"] = o.ExpectedSHA256
	}
	if o.ExpectedContentType != "" {
		out["expectedContentType"] = o.ExpectedContentType
	}
	return out
}

type Object struct {
	client *Client
	ID     string
}

func (c *Client) Object(id string) *Object { return &Object{client: c, ID: id} }
func (c *Client) CreateObject(ctx context.Context, options ObjectOptions) (*Object, error) {
	if len(options.Config) != 0 && options.ConfigFile != "" {
		return nil, errors.New("choose either Config or ConfigFile")
	}
	raw, err := c.invoke(ctx, "object.create", "", options.payload(), nil)
	info, err := decode[AcquisitionInfo](raw, err)
	if info == nil {
		return nil, err
	}
	return c.Object(info.ID), err
}

// AttachObject binds an existing original native session; initialization is offline.
func (c *Client) AttachObject(ctx context.Context, id, directory string, accountingOnly bool) (*Object, error) {
	raw, err := c.invoke(ctx, "object.attach", "", map[string]any{
		"id": id, "directory": directory, "accountingOnly": accountingOnly}, nil)
	info, err := decode[AcquisitionInfo](raw, err)
	if info == nil {
		return nil, err
	}
	return c.Object(info.ID), err
}
func (c *Client) ListObjects(ctx context.Context) ([]AcquisitionInfo, error) {
	raw, err := c.invoke(ctx, "object.list", "", nil, nil)
	values, err := decode[[]AcquisitionInfo](raw, err)
	if values == nil {
		return nil, err
	}
	return *values, err
}

type ObjectReport struct {
	Record       json.RawMessage `json:"record"`
	Process      ProcessOutcome  `json:"process"`
	Status       string          `json:"status"`
	Native       json.RawMessage `json:"native"`
	ChunkPage    json.RawMessage `json:"chunkPage"`
	AssemblyPage json.RawMessage `json:"assemblyPage"`
}
type ObjectDelivery struct {
	Path            string          `json:"path"`
	Assembly        json.RawMessage `json:"assembly"`
	ReceiptRecorded bool            `json:"receiptRecorded"`
	Report          ObjectReport    `json:"report"`
}

func (o *Object) command(ctx context.Context, action string, options PageOptions) (*ObjectReport, error) {
	raw, err := o.client.invoke(ctx, action, o.ID, map[string]any{"options": options}, nil)
	return decode[ObjectReport](raw, err)
}
func (o *Object) Initialize(ctx context.Context, options PageOptions) (*ObjectReport, error) {
	return o.command(ctx, "object.initialize", options)
}
func (o *Object) Inspect(ctx context.Context, options PageOptions) (*ObjectReport, error) {
	return o.command(ctx, "object.inspect", options)
}
func (o *Object) Recover(ctx context.Context, options PageOptions) (*ObjectReport, error) {
	return o.command(ctx, "object.recover", options)
}
func (o *Object) Run(ctx context.Context, options PageOptions) (*ObjectReport, error) {
	return o.command(ctx, "object.run", options)
}
func (o *Object) delivery(ctx context.Context, action, destination string, options PageOptions) (*ObjectDelivery, error) {
	args := map[string]any{"options": options}
	if destination != "" {
		args["destination"] = destination
	}
	raw, err := o.client.invoke(ctx, action, o.ID, args, nil)
	return decode[ObjectDelivery](raw, err)
}

// Download acquires through the original resumable session and assembles its file.
func (o *Object) Download(ctx context.Context, destination string, options PageOptions) (*ObjectDelivery, error) {
	return o.delivery(ctx, "object.download", destination, options)
}
func (o *Object) Assemble(ctx context.Context, destination string, options PageOptions) (*ObjectDelivery, error) {
	return o.delivery(ctx, "object.assemble", destination, options)
}
func (o *Object) Delivery(ctx context.Context, destination string, options PageOptions) (*ObjectDelivery, error) {
	return o.delivery(ctx, "object.delivery", destination, options)
}
func (o *Object) File(destination string) *File {
	selection := map[string]any{"kind": "object", "id": o.ID}
	if destination != "" {
		selection["destination"] = destination
	}
	return &File{client: o.client, selection: selection}
}
func (o *Object) ExportReport(ctx context.Context, destination, format string, options PageOptions) (*ObjectReport, error) {
	if format == "" {
		format = "html"
	}
	raw, err := o.client.invoke(ctx, "object.report", o.ID, map[string]any{
		"destination": destination, "format": format, "options": options}, nil)
	return decode[ObjectReport](raw, err)
}
func (o *Object) Accounting(ctx context.Context, options json.RawMessage) (json.RawMessage, error) {
	return o.client.invoke(ctx, "object.accounting", o.ID, map[string]any{"options": options}, nil)
}
func (o *Object) Finalize(ctx context.Context, options json.RawMessage) (json.RawMessage, error) {
	return o.client.invoke(ctx, "object.finalize", o.ID, map[string]any{"options": options}, nil)
}
func (o *Object) RecoverAccounting(ctx context.Context, options json.RawMessage) (json.RawMessage, error) {
	return o.client.invoke(ctx, "object.recover-accounting", o.ID, map[string]any{"options": options}, nil)
}

type DatasetOptions struct {
	ID                 string
	Config             json.RawMessage
	ConfigFile         string
	WorkspaceDirectory string
	OperatorProfile    string
	MaxPages           int
	MaxTotalAtomic     string
	MaxRows            *int64
	MaxPageBytes       *int64
	ExpectedSnapshot   string
}

func (o DatasetOptions) payload() map[string]any {
	out := map[string]any{"id": o.ID, "maxPages": o.MaxPages, "maxTotalAtomic": o.MaxTotalAtomic}
	if len(o.Config) != 0 {
		out["config"] = o.Config
	}
	if o.ConfigFile != "" {
		out["config"] = o.ConfigFile
	}
	if o.WorkspaceDirectory != "" {
		out["workspaceDirectory"] = o.WorkspaceDirectory
	}
	if o.OperatorProfile != "" {
		out["operatorProfile"] = o.OperatorProfile
	}
	if o.MaxRows != nil {
		out["maxRows"] = *o.MaxRows
	}
	if o.MaxPageBytes != nil {
		out["maxPageBytes"] = *o.MaxPageBytes
	}
	if o.ExpectedSnapshot != "" {
		out["expectedSnapshot"] = o.ExpectedSnapshot
	}
	return out
}

type Dataset struct {
	client *Client
	ID     string
}

func (c *Client) Dataset(id string) *Dataset { return &Dataset{client: c, ID: id} }
func (c *Client) CreateDataset(ctx context.Context, options DatasetOptions) (*Dataset, error) {
	if len(options.Config) != 0 && options.ConfigFile != "" {
		return nil, errors.New("choose either Config or ConfigFile")
	}
	raw, err := c.invoke(ctx, "dataset.create", "", options.payload(), nil)
	info, err := decode[AcquisitionInfo](raw, err)
	if info == nil {
		return nil, err
	}
	return c.Dataset(info.ID), err
}
func (c *Client) AttachDataset(ctx context.Context, id, directory string, accountingOnly bool) (*Dataset, error) {
	raw, err := c.invoke(ctx, "dataset.attach", "", map[string]any{
		"id": id, "directory": directory, "accountingOnly": accountingOnly}, nil)
	info, err := decode[AcquisitionInfo](raw, err)
	if info == nil {
		return nil, err
	}
	return c.Dataset(info.ID), err
}
func (c *Client) ListDatasets(ctx context.Context) ([]AcquisitionInfo, error) {
	raw, err := c.invoke(ctx, "dataset.list", "", nil, nil)
	values, err := decode[[]AcquisitionInfo](raw, err)
	if values == nil {
		return nil, err
	}
	return *values, err
}

type DatasetProgress struct {
	Native  json.RawMessage `json:"native"`
	Process ProcessOutcome  `json:"process"`
}
type DatasetDelivery struct {
	Report   json.RawMessage `json:"report"`
	Manifest json.RawMessage `json:"manifest"`
}

func (d *Dataset) command(ctx context.Context, action string) (*DatasetProgress, error) {
	raw, err := d.client.invoke(ctx, action, d.ID, nil, nil)
	return decode[DatasetProgress](raw, err)
}
func (d *Dataset) Initialize(ctx context.Context) (*DatasetProgress, error) {
	return d.command(ctx, "dataset.initialize")
}
func (d *Dataset) Inspect(ctx context.Context) (*DatasetProgress, error) {
	return d.command(ctx, "dataset.inspect")
}
func (d *Dataset) Recover(ctx context.Context) (*DatasetProgress, error) {
	return d.command(ctx, "dataset.recover")
}
func (d *Dataset) Run(ctx context.Context) (*DatasetProgress, error) {
	return d.command(ctx, "dataset.run")
}
func (d *Dataset) Deliver(ctx context.Context, destination string) (*DatasetDelivery, error) {
	args := map[string]any{}
	if destination != "" {
		args["destination"] = destination
	}
	raw, err := d.client.invoke(ctx, "dataset.deliver", d.ID, args, nil)
	return decode[DatasetDelivery](raw, err)
}

// File reopens or produces the original offline delivery and selects a declared
// export: dataset.jsonl, dataset.csv, review.html or manifest.json.
func (d *Dataset) File(destination, name string) *File {
	selection := map[string]any{"kind": "dataset", "id": d.ID, "name": name}
	if destination != "" {
		selection["destination"] = destination
	}
	return &File{client: d.client, selection: selection}
}
func (d *Dataset) ExportManifest(ctx context.Context, destination string) (*DatasetProgress, error) {
	raw, err := d.client.invoke(ctx, "dataset.manifest", d.ID, map[string]any{"destination": destination}, nil)
	return decode[DatasetProgress](raw, err)
}
func (d *Dataset) Accounting(ctx context.Context, options json.RawMessage) (json.RawMessage, error) {
	return d.client.invoke(ctx, "dataset.accounting", d.ID, map[string]any{"options": options}, nil)
}
func (d *Dataset) Finalize(ctx context.Context, options json.RawMessage) (json.RawMessage, error) {
	return d.client.invoke(ctx, "dataset.finalize", d.ID, map[string]any{"options": options}, nil)
}
func (d *Dataset) RecoverAccounting(ctx context.Context, options json.RawMessage) (json.RawMessage, error) {
	return d.client.invoke(ctx, "dataset.recover-accounting", d.ID, map[string]any{"options": options}, nil)
}
