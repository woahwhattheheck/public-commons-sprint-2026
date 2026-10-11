// MIT. A runnable Go customer for the original SF88 Node application.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	buyer "github.com/woahwhattheheck/public-commons-sprint-2026/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/go"
)

func readJSON(path string) (json.RawMessage, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, (32<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > 32<<20 || !json.Valid(raw) {
		return nil, errors.New("input must be one JSON value within 32 MiB")
	}
	return raw, nil
}
func output(writer io.Writer, value any) error {
	encoder := json.NewEncoder(writer)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}
func save(path string, value []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(value); err == nil {
		_, err = f.Write([]byte("\n"))
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func run(ctx context.Context, argv []string) error {
	global := flag.NewFlagSet("starforge-buyer", flag.ContinueOnError)
	runtimeDirectory := global.String("runtime", "", "absolute selected SF88 runtime directory")
	state := global.String("state", "", "absolute private original Node buyer state")
	bridge := global.String("bridge", "", "Go bridge path (defaults to runtime/go/bridge.mjs)")
	node := global.String("node", "node", "Node executable")
	profile := global.String("profile", "", "absolute existing native operator profile")
	timeout := global.Duration("timeout", 6*time.Minute, "original native command timeout")
	if err := global.Parse(argv); err != nil {
		return err
	}
	args := global.Args()
	if len(args) == 0 {
		return errors.New("command required: ready, create, list, review, inspect, execute, recover, copy, read, records, object-*, dataset-*")
	}
	command := args[0]
	local := flag.NewFlagSet(command, flag.ContinueOnError)
	id := local.String("id", "", "stable original intent or acquisition ID")
	config := local.String("config", "", "original buyer configuration file")
	optionsFile := local.String("options", "", "JSON creation/accounting options file")
	bodyFile := local.String("body", "", "exact request body file; omitted preserves body absence")
	out := local.String("out", "", "new output path or original delivery directory")
	reviewFile := local.String("review", "", "saved original review JSON file")
	session := local.String("session", "", "original native session to attach")
	delivery := local.String("delivery", "", "existing object file or dataset delivery directory")
	inboxDirectory := local.String("inbox", "", "absolute original native inbox directory")
	workspace := local.String("workspace", "", "absolute original native workspace")
	responseRecord := local.String("record", "", "original BuyerResult record JSON file")
	responseConfiguration := local.String("response-config", "", "original response-file configuration JSON file")
	name := local.String("file", "dataset.jsonl", "declared dataset export name")
	format := local.String("format", "ndjson", "ndjson, sse, csv, html or json")
	partial := local.Bool("partial", false, "consume the original complete-record prefix of a partial response")
	offset := local.Int("offset", 0, "original chunk report offset")
	limit := local.Int("limit", 50, "original chunk report limit")
	accountingOnly := local.Bool("accounting-only", false, "attach original accounting without delivered bytes")
	if err := local.Parse(args[1:]); err != nil {
		return err
	}
	if local.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	client, err := buyer.New(buyer.Options{RuntimeDirectory: *runtimeDirectory, StateDirectory: *state,
		BridgePath: *bridge, Node: *node, OperatorProfile: *profile, NativeTimeout: *timeout, ApprovalInput: os.Stdin})
	if err != nil {
		return err
	}
	pages := buyer.PageOptions{ChunkOffset: *offset, ChunkLimit: *limit}
	needID := func() error {
		if *id == "" {
			return errors.New("-id is required")
		}
		return nil
	}
	needOut := func() error {
		if *out == "" {
			return errors.New("-out is required")
		}
		return nil
	}
	emit := func(value any, err error) error {
		if value != nil {
			if printErr := output(os.Stdout, value); printErr != nil {
				return errors.Join(err, printErr)
			}
		}
		return err
	}
	records := func(file *buyer.File, selected buyer.RecordFormat) error {
		transfer, err := file.Records(ctx, selected, buyer.RecordOptions{AllowPartial: *partial},
			func(value json.RawMessage) error { return output(os.Stdout, value) })
		if transfer != nil {
			output(os.Stderr, transfer)
		}
		return err
	}
	switch command {
	case "ready":
		value, err := client.Ready(ctx)
		return emit(value, err)
	case "list":
		value, err := client.List(ctx)
		return emit(value, err)
	case "create":
		if *config == "" {
			return errors.New("-config is required")
		}
		var options buyer.CreateOptions
		if *bodyFile != "" {
			f, err := os.Open(*bodyFile)
			if err != nil {
				return err
			}
			options.Body, err = io.ReadAll(io.LimitReader(f, (16<<20)+1))
			f.Close()
			if err != nil {
				return err
			}
			if len(options.Body) > 16<<20 {
				return errors.New("request body exceeds 16 MiB")
			}
		}
		value, err := client.CreateFromFile(ctx, *config, options)
		if value != nil {
			return emit(map[string]string{"intentId": value.IntentID}, err)
		}
		return err
	case "review":
		if err := needID(); err != nil {
			return err
		}
		value, err := client.Operation(*id).Review(ctx)
		if err != nil {
			return err
		}
		if *out != "" {
			return save(*out, value)
		}
		return emit(value, nil)
	case "inspect":
		if err := needID(); err != nil {
			return err
		}
		value, err := client.Operation(*id).Inspect(ctx)
		return emit(value, err)
	case "execute":
		if err := needID(); err != nil {
			return err
		}
		if *reviewFile == "" {
			return errors.New("-review is required")
		}
		review, err := readJSON(*reviewFile)
		if err != nil {
			return err
		}
		value, err := client.Operation(*id).Execute(ctx, review)
		return emit(value, err)
	case "recover":
		if err := needID(); err != nil {
			return err
		}
		value, err := client.Operation(*id).Recover(ctx)
		if value == nil && err == nil {
			return output(os.Stdout, map[string]any{"intentId": *id, "result": nil})
		}
		return emit(value, err)
	case "copy":
		if err := needID(); err != nil {
			return err
		}
		if err := needOut(); err != nil {
			return err
		}
		value, err := client.Operation(*id).File().SaveAs(ctx, *out)
		return emit(value, err)
	case "read":
		if err := needID(); err != nil {
			return err
		}
		value, err := client.Operation(*id).File().WriteTo(ctx, os.Stdout)
		if value != nil {
			output(os.Stderr, value)
		}
		return err
	case "records":
		if err := needID(); err != nil {
			return err
		}
		return records(client.Operation(*id).File(), buyer.RecordFormat(*format))
	case "object-list":
		value, err := client.ListObjects(ctx)
		return emit(value, err)
	case "response-verify", "response-read", "response-copy", "response-records":
		record, err := readJSON(*responseRecord)
		if err != nil {
			return err
		}
		configuration, err := readJSON(*responseConfiguration)
		if err != nil {
			return err
		}
		file := client.Response(record, configuration)
		switch command {
		case "response-verify":
			value, err := file.Verify(ctx)
			return emit(value, err)
		case "response-copy":
			if err := needOut(); err != nil {
				return err
			}
			value, err := file.SaveAs(ctx, *out)
			return emit(value, err)
		case "response-read":
			value, err := file.WriteTo(ctx, os.Stdout)
			if value != nil {
				output(os.Stderr, value)
			}
			return err
		default:
			return records(file, buyer.RecordFormat(*format))
		}
	case "inbox-create", "inbox-list", "inbox-show", "inbox-enqueue", "inbox-enqueue-config",
		"inbox-review", "inbox-execute", "inbox-cancel", "inbox-recover", "inbox-finalize",
		"inbox-report", "inbox-response", "inbox-copy", "inbox-read", "inbox-records":
		inbox, err := client.Inbox(*inboxDirectory)
		if err != nil {
			return err
		}
		switch command {
		case "inbox-create":
			value, err := client.CreateInbox(ctx, *inboxDirectory)
			if value != nil {
				return emit(map[string]string{"directory": value.Directory}, err)
			}
			return err
		case "inbox-list":
			value, err := inbox.List(ctx)
			return emit(value, err)
		case "inbox-enqueue-config":
			if *config == "" {
				return errors.New("-config is required")
			}
			value, err := inbox.EnqueueConfig(ctx, *config)
			return emit(value, err)
		case "inbox-report":
			if err := needOut(); err != nil {
				return err
			}
			value, err := inbox.ExportReport(ctx, *out, *workspace)
			return emit(value, err)
		}
		if err := needID(); err != nil {
			return err
		}
		switch command {
		case "inbox-show":
			value, err := inbox.Show(ctx, *id)
			return emit(value, err)
		case "inbox-enqueue":
			value, err := inbox.Enqueue(ctx, client.Operation(*id))
			return emit(value, err)
		case "inbox-review":
			value, err := inbox.Review(ctx, *id)
			if err != nil {
				return err
			}
			if *out != "" {
				return save(*out, value)
			}
			return emit(value, nil)
		case "inbox-execute":
			review, err := readJSON(*reviewFile)
			if err != nil {
				return err
			}
			value, err := inbox.Execute(ctx, *id, review, *workspace)
			return emit(value, err)
		case "inbox-cancel":
			value, err := inbox.Cancel(ctx, *id)
			return emit(value, err)
		case "inbox-recover":
			value, err := inbox.Recover(ctx, *id)
			return emit(value, err)
		case "inbox-finalize":
			options, err := readJSON(*optionsFile)
			if err != nil {
				return err
			}
			value, err := inbox.Finalize(ctx, *id, options)
			return emit(value, err)
		case "inbox-response":
			value, err := inbox.Response(ctx, *id)
			return emit(value, err)
		case "inbox-copy":
			if err := needOut(); err != nil {
				return err
			}
			value, err := inbox.File(*id).SaveAs(ctx, *out)
			return emit(value, err)
		case "inbox-read":
			value, err := inbox.File(*id).WriteTo(ctx, os.Stdout)
			if value != nil {
				output(os.Stderr, value)
			}
			return err
		default:
			return records(inbox.File(*id), buyer.RecordFormat(*format))
		}
	case "object-create":
		raw, err := readJSON(*optionsFile)
		if err != nil {
			return err
		}
		var options buyer.ObjectOptions
		if err := json.Unmarshal(raw, &options); err != nil {
			return err
		}
		value, err := client.CreateObject(ctx, options)
		if value != nil {
			return emit(map[string]string{"id": value.ID}, err)
		}
		return err
	case "object-attach":
		if err := needID(); err != nil {
			return err
		}
		value, err := client.AttachObject(ctx, *id, *session, *accountingOnly)
		if value != nil {
			return emit(map[string]string{"id": value.ID}, err)
		}
		return err
	case "object-inspect", "object-recover", "object-run", "object-initialize":
		if err := needID(); err != nil {
			return err
		}
		object := client.Object(*id)
		var value *buyer.ObjectReport
		switch command {
		case "object-inspect":
			value, err = object.Inspect(ctx, pages)
		case "object-recover":
			value, err = object.Recover(ctx, pages)
		case "object-run":
			value, err = object.Run(ctx, pages)
		case "object-initialize":
			value, err = object.Initialize(ctx, pages)
		}
		return emit(value, err)
	case "object-download", "object-assemble", "object-delivery":
		if err := needID(); err != nil {
			return err
		}
		object := client.Object(*id)
		var value *buyer.ObjectDelivery
		switch command {
		case "object-download":
			if err := needOut(); err != nil {
				return err
			}
			value, err = object.Download(ctx, *out, pages)
		case "object-assemble":
			if err := needOut(); err != nil {
				return err
			}
			value, err = object.Assemble(ctx, *out, pages)
		case "object-delivery":
			value, err = object.Delivery(ctx, *delivery, pages)
		}
		return emit(value, err)
	case "object-copy":
		if err := needID(); err != nil {
			return err
		}
		if err := needOut(); err != nil {
			return err
		}
		value, err := client.Object(*id).File(*delivery).SaveAs(ctx, *out)
		return emit(value, err)
	case "object-report":
		if err := needID(); err != nil {
			return err
		}
		if err := needOut(); err != nil {
			return err
		}
		value, err := client.Object(*id).ExportReport(ctx, *out, *format, pages)
		return emit(value, err)
	case "dataset-list":
		value, err := client.ListDatasets(ctx)
		return emit(value, err)
	case "dataset-create":
		raw, err := readJSON(*optionsFile)
		if err != nil {
			return err
		}
		var options buyer.DatasetOptions
		if err := json.Unmarshal(raw, &options); err != nil {
			return err
		}
		value, err := client.CreateDataset(ctx, options)
		if value != nil {
			return emit(map[string]string{"id": value.ID}, err)
		}
		return err
	case "dataset-attach":
		if err := needID(); err != nil {
			return err
		}
		value, err := client.AttachDataset(ctx, *id, *session, *accountingOnly)
		if value != nil {
			return emit(map[string]string{"id": value.ID}, err)
		}
		return err
	case "dataset-inspect", "dataset-recover", "dataset-run", "dataset-initialize":
		if err := needID(); err != nil {
			return err
		}
		dataset := client.Dataset(*id)
		var value *buyer.DatasetProgress
		switch command {
		case "dataset-inspect":
			value, err = dataset.Inspect(ctx)
		case "dataset-recover":
			value, err = dataset.Recover(ctx)
		case "dataset-run":
			value, err = dataset.Run(ctx)
		case "dataset-initialize":
			value, err = dataset.Initialize(ctx)
		}
		return emit(value, err)
	case "dataset-deliver":
		if err := needID(); err != nil {
			return err
		}
		value, err := client.Dataset(*id).Deliver(ctx, *out)
		return emit(value, err)
	case "dataset-copy":
		if err := needID(); err != nil {
			return err
		}
		if err := needOut(); err != nil {
			return err
		}
		value, err := client.Dataset(*id).File(*delivery, *name).SaveAs(ctx, *out)
		return emit(value, err)
	case "dataset-rows":
		if err := needID(); err != nil {
			return err
		}
		return records(client.Dataset(*id).File(*delivery, "dataset.jsonl"), buyer.DatasetRows)
	case "object-accounting", "object-finalize", "object-recover-accounting",
		"dataset-accounting", "dataset-finalize", "dataset-recover-accounting":
		if err := needID(); err != nil {
			return err
		}
		options := json.RawMessage("{}")
		if *optionsFile != "" {
			options, err = readJSON(*optionsFile)
			if err != nil {
				return err
			}
		}
		var value json.RawMessage
		switch command {
		case "object-accounting":
			value, err = client.Object(*id).Accounting(ctx, options)
		case "object-finalize":
			value, err = client.Object(*id).Finalize(ctx, options)
		case "object-recover-accounting":
			value, err = client.Object(*id).RecoverAccounting(ctx, options)
		case "dataset-accounting":
			value, err = client.Dataset(*id).Accounting(ctx, options)
		case "dataset-finalize":
			value, err = client.Dataset(*id).Finalize(ctx, options)
		case "dataset-recover-accounting":
			value, err = client.Dataset(*id).RecoverAccounting(ctx, options)
		}
		return emit(value, err)
	default:
		return fmt.Errorf("unknown command: %s", command)
	}
}
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
