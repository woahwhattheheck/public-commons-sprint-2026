package buyer

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"unicode/utf8"
)

func encodeBody(value []byte) string { return base64.StdEncoding.EncodeToString(value) }

// File is an original saved response, assembled object or dataset export.
// The selected Node VerifiedFile owns its size, digest and atomic-copy checks.
type File struct {
	client    *Client
	selection map[string]any
}
type FileInfo struct {
	Path   string `json:"path,omitempty"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}
type Transfer struct {
	Bytes   int64  `json:"bytes"`
	Records int64  `json:"records,omitempty"`
	SHA256  string `json:"sha256,omitempty"`
}

func (f *File) Verify(ctx context.Context) (*FileInfo, error) {
	raw, err := f.client.invoke(ctx, "file.verify", "", map[string]any{"selection": f.selection}, nil)
	return decode[FileInfo](raw, err)
}

// SaveAs uses the original verified, fsynced, non-overwriting publication.
func (f *File) SaveAs(ctx context.Context, destination string) (*FileInfo, error) {
	raw, err := f.client.invoke(ctx, "file.copy", "", map[string]any{
		"selection": f.selection, "destination": destination}, nil)
	return decode[FileInfo](raw, err)
}

// WriteTo streams without buffering the complete file. Commit downstream effects
// only after it returns nil: the original reader verifies the complete transfer.
func (f *File) WriteTo(ctx context.Context, writer io.Writer) (*Transfer, error) {
	if writer == nil {
		return nil, errors.New("output writer is required")
	}
	var copied int64
	raw, err := f.client.invoke(ctx, "file.stream", "", map[string]any{"selection": f.selection},
		func(reader io.Reader) error {
			var err error
			copied, err = io.Copy(writer, reader)
			return err
		})
	value, err := decode[Transfer](raw, err)
	if err == nil && (value == nil || value.Bytes != copied) {
		return value, errors.New("original file transfer byte count mismatch")
	}
	return value, err
}

// Bytes returns only a completely verified file within the explicit memory limit.
// A zero limit accepts an original empty file.
func (f *File) Bytes(ctx context.Context, limit int64) ([]byte, error) {
	if limit < 0 || limit > 268435456 {
		return nil, errors.New("byte limit must be between zero and 256 MiB; use WriteTo for larger files")
	}
	var buffer bytes.Buffer
	raw, err := f.client.invoke(ctx, "file.bytes", "", map[string]any{
		"selection": f.selection, "limit": limit}, func(reader io.Reader) error {
		_, err := io.Copy(&buffer, io.LimitReader(reader, limit+1))
		if err != nil {
			return err
		}
		if int64(buffer.Len()) > limit {
			return errors.New("Go response byte limit exceeded")
		}
		return nil
	})
	value, err := decode[Transfer](raw, err)
	if err != nil {
		return nil, err
	}
	if value == nil || value.Bytes != int64(buffer.Len()) {
		return nil, errors.New("original file byte count mismatch")
	}
	return buffer.Bytes(), nil
}

// JSON decodes the original verified bytes directly in Go. Numbers in interfaces
// use json.Number, preserving integer lexemes instead of converting to float64.
func (f *File) JSON(ctx context.Context, destination any, limit int64) error {
	if destination == nil {
		return errors.New("JSON destination is required")
	}
	raw, err := f.Bytes(ctx, limit)
	if err != nil {
		return err
	}
	if !utf8.Valid(raw) {
		return errors.New("response JSON is not valid UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON values in response")
		}
		return err
	}
	return nil
}

type RecordFormat string

const (
	NDJSON      RecordFormat = "ndjson"
	SSE         RecordFormat = "sse"
	CSV         RecordFormat = "csv"
	DatasetRows RecordFormat = "dataset"
)

type RecordOptions struct {
	AllowPartial       bool `json:"allowPartial,omitempty"`
	MaxRecordBytes     int  `json:"maxRecordBytes,omitempty"`
	MaxRecords         int  `json:"maxRecords,omitempty"`
	Headers            bool `json:"headers,omitempty"`
	MaxFieldCharacters int  `json:"maxFieldCharacters,omitempty"`
	MaxRowCharacters   int  `json:"maxRowCharacters,omitempty"`
}

// Records uses the original stream/CSV/dataset decoder. Callback values are one
// JSON value each. Return an error to stop consumption. Complete success includes
// the original saved hash and fully framed-prefix checks, including allowPartial.
func (f *File) Records(ctx context.Context, format RecordFormat, options RecordOptions, consume func(json.RawMessage) error) (*Transfer, error) {
	if consume == nil {
		return nil, errors.New("record consumer is required")
	}
	switch format {
	case NDJSON, SSE, CSV, DatasetRows:
	default:
		return nil, fmt.Errorf("unsupported record format: %s", format)
	}
	var count int64
	raw, err := f.client.invoke(ctx, "file.records", "", map[string]any{
		"selection": f.selection, "format": format, "options": options}, func(reader io.Reader) error {
		decoder := json.NewDecoder(reader)
		for {
			var value json.RawMessage
			if err := decoder.Decode(&value); err != nil {
				if err == io.EOF {
					return nil
				}
				return err
			}
			if err := consume(value); err != nil {
				return err
			}
			count++
		}
	})
	value, err := decode[Transfer](raw, err)
	if err == nil && (value == nil || value.Records != count) {
		return value, errors.New("original stream record count mismatch")
	}
	return value, err
}
