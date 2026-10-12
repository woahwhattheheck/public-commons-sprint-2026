# DSpace repository data in Applications

Use **DSpace repository data** to reopen the same repository operator that the browser and agent client use. The application retains its sources, complete metadata values, editions, review decisions, comparisons, selected project and original operation history.

## Open an existing workspace

1. Choose an installed, ready Starforge runtime containing the DSpace contribution.
2. Open **Applications**, select **DSpace repository data**, and name the application.
3. Set **Private repository operator** to the original operator folder. For a new operator, choose one new folder inside a private existing parent.
4. For a new operator, optionally select the **Existing repository workspace** created by `starforge dspace receive` or the original DSpace workspace commands.
5. Leave **Local port** at `0` to choose an available port. Review the settings, save the application, and choose **Start**.
6. Choose **Open**. The original repository browser opens with its saved project, complete sources and selected edition.

The saved operator registry owns the project list. Reopening an existing operator keeps its selected project. An optional workspace field initializes a new operator; changing that field does not replace the saved project's data.

Closing a browser tab leaves the managed application running. Choose **Stop** in Applications to close the original server and release its writer. Choose **Start** again to reopen the saved operator and its original workspace history.

## Work through the original browser

Use the repository browser to import retained DSpace source files, inspect complete item metadata, define a projection, build an edition, record a review and select an approved edition. Comparison retains the before and after editions. Native query controls use the selected immutable edition and its original cursor.

Download the complete edition as CSV or JSON, or download the SQLite project when another operator needs the complete retained workspace. Receiving the same SQLite archive with the original receiving request ID reopens the same received project. Existing source, edition, comparison, review and operation identifiers stay with the project.

The original Linux writer lease protects each operator and repository workspace. An independently opened operator already using the same workspace must finish or close before Applications can open it. The application reports the original writer's conflict rather than opening a second database writer.

## Connect an agent to the running application

The running operator writes `operator-launch.json` into its private operator folder. This file is owned by the operating user, has mode `0600`, and contains the private connection credential. Select this exact file in the merchant host's named DSpace connection. The application does not place the credential in its startup output, browser URL or public state.

The agent host attaches to the managed listener. It uses the original HTTP routes and dataset engine; closing the agent connection leaves the Applications process running. See the DSpace `AGENT.md` guide for the host configuration, available operations and complete file receiving.

Each bound agent request carries four identities: operator, process instance, selected project and workspace. If a browser user switches projects, or Applications restarts the operator, an old scope receives a conflict. Read and bind the current project before continuing. Keep the original operation ID when recovering an uncertain source, edition, review or receiving response.

A successful project selection or full workspace receive returns the newly selected scope. The client uses that returned scope for subsequent work. A stale scope never silently follows another user's project selection.

## What Applications saves

The settings review binds the private operator directory, optional initial workspace, original installed DSpace source and native writer source. Start checks the same selection again and compares the executed application files with the reviewed source. The managed worker reads the original structured startup announcement and verifies the private launch file against the live authenticated listener.

The saved application URL records the original operator identity, process instance, selected workspace, source digests and process ID. Mutable repository revisions remain in the original SQLite workspace and are not copied into application settings.

Stopping the application writes a closed launch marker while the original writer lease is still held. Reopening retains the operator identity and starts a fresh process instance. An agent holding the previous instance must bind the running instance again.

## Command line equivalent

```sh
starforge dspace-workspace \
  --directory /private/repository-operator \
  --workspace /private/repository-workspace \
  --port 0
```

The command prints one structured, nonsecret startup record. Open its `url` in the local browser, or attach through the private launch file. The same command also supports the managed source-selection flags used by Applications.

Use a real private folder owned by the operating user. Keep the original operator directory and repository workspace together when retaining a working installation. For a portable customer handoff, use the complete native SQLite export and receive it into the target operator.
