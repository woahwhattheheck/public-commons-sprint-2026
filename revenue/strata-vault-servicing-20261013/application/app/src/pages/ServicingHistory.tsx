import { useEffect, useMemo, useRef, useState } from "react"
import { network } from "@stellar-scaffold/app-lib"
import { StrKey } from "@stellar/stellar-sdk"
import {
  inspectArchive, deriveHistory, investorStatement, statementCSV, reportCSV,
  type Archive, type HistoryReport, type HistoryEvent, type RequestEpisode,
  type InvestorStatement, type StatementSelection, type ContractRole,
} from "../../../app-lib/servicing/model.mjs"
import { contractRows } from "../config/contracts"
import {
  digestBlob, downloadJSON, downloadOriginal, listArchives, retainArchive, reopenArchive,
  type ArchiveEntry,
} from "../history/archiveStore"
import { ExactValue, HistoryTable, OriginalDetails } from "../history/HistoryComponents"
import { statementHTML } from "../history/statementHTML"
import styles from "./ServicingHistory.module.css"

type Section = "activity" | "requests" | "valuations" | "epochs" | "treasury" | "coverage"
const SECTIONS: [Section, string][] = [
  ["activity", "Activity"], ["requests", "Requests and statements"], ["valuations", "Valuations"],
  ["epochs", "Epochs"], ["treasury", "Treasury and wind-down"], ["coverage", "Coverage and source"],
]
const CONTRACT_LABELS: [ContractRole, string][] = [
  ["async_vault", "Vault"], ["share_token", "Share token"], ["nav_oracle", "NAV oracle"],
  ["identity_verifier", "Identity verifier"], ["compliance", "Compliance"], ["asset", "Deposit asset"],
]
interface Opened {
  entry: ArchiveEntry
  blob: Blob
  archive: Archive
  report: HistoryReport
  saved: boolean
}
interface Detail { title: string; value: unknown }
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)
const jsonContains = (row: unknown, search: string) =>
  !search || JSON.stringify(row).toLowerCase().includes(search.toLowerCase())
function hasExactAddress(value: unknown, address: string): boolean {
  if (typeof value === "string") return value === address
  if (Array.isArray(value)) return value.some(item => hasExactAddress(item, address))
  if (value && typeof value === "object") return Object.values(value).some(item => hasExactAddress(item, address))
  return false
}
const SHARE_TOTALS = new Set(["sharesClaimed", "sharesRequestedForRedemption", "sharesReturned", "windDownSharesSurrendered"])
const ledgerInput = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  if (!/^[0-9]+$/.test(value)) throw new Error("Ledger boundaries must be whole nonnegative numbers.")
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > 4_294_967_295)
    throw new Error("Select a ledger boundary in the chain's u32 range.")
  return parsed
}
const csvDownload = (value: string, name: string) =>
  downloadOriginal(new Blob([value], { type: "text/csv;charset=utf-8" }), name)
function timestamp(value: string | null | undefined): string {
  if (!value) return "Unobserved"
  if (/^\d+$/.test(value)) {
    const ms = BigInt(value) * 1000n
    if (ms > 8_640_000_000_000_000n) return value + " seconds"
    return new Date(Number(ms)).toISOString()
  }
  return value
}
function statusLabel(value: string) { return value.toLowerCase().replaceAll("_", " ") }

export default function ServicingHistory() {
  const [archives, setArchives] = useState<ArchiveEntry[]>([])
  const [opened, setOpened] = useState<Opened | null>(null)
  const [section, setSection] = useState<Section>("activity")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("Open a complete servicing archive or reopen a saved original.")
  const [isError, setIsError] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [search, setSearch] = useState("")
  const [controller, setController] = useState("")
  const [from, setFrom] = useState("")
  const [through, setThrough] = useState("")
  const generation = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const report = opened?.report ?? null
  const controllerError = controller && !StrKey.isValidEd25519PublicKey(controller) && !StrKey.isValidContract(controller)
    ? "Enter a complete valid investor G-address or contract C-address." : null

  useEffect(() => {
    let active = true
    listArchives().then(rows => { if (active) setArchives(rows) })
      .catch(error => { if (active) { setNotice(messageOf(error)); setIsError(true) } })
    return () => { active = false; generation.current++ }
  }, [])

  async function refreshShelf() {
    try { setArchives(await listArchives()) }
    catch (error) { setNotice(messageOf(error)); setIsError(true) }
  }
  async function openOriginal(blob: Blob, name: string, retained?: ArchiveEntry) {
    const current = ++generation.current
    setBusy(true); setOpened(null); setDetail(null); setIsError(false)
    setNotice("Reading and validating the complete original archive…")
    try {
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(await blob.arrayBuffer())
      const archive = await inspectArchive(raw)
      const derived = deriveHistory(archive)
      const digest = retained?.sha256 ?? await digestBlob(blob)
      if (retained && (retained.sha256 !== digest || retained.bytes !== blob.size))
        throw new Error("The complete saved archive differs from its original identity.")
      let entry = retained ?? { sha256: digest, name, bytes: blob.size, importedAt: new Date().toISOString() }
      let saved = !!retained
      let storageError = ""
      if (current !== generation.current) return
      if (!saved) {
        try { const result = await retainArchive(blob, entry); entry = result.entry; saved = true }
        catch (error) { storageError = messageOf(error) }
      }
      if (current !== generation.current) return
      setOpened({ entry, blob, archive, report: derived, saved })
      setSearch(""); setController(""); setFrom(""); setThrough("")
      setNotice(saved
        ? "Opened " + entry.name + ". Complete original saved in this browser."
        : "Opened in memory. Browser saving failed: " + storageError + " Download the original before closing this page.")
      setIsError(!saved)
      if (saved) await refreshShelf()
    } catch (error) {
      if (current === generation.current) { setNotice(messageOf(error)); setIsError(true) }
    } finally { if (current === generation.current) setBusy(false) }
  }
  async function reopen(entry: ArchiveEntry) {
    const current = ++generation.current
    setBusy(true); setOpened(null); setDetail(null); setIsError(false)
    setNotice("Reopening the complete saved original…")
    try {
      const original = await reopenArchive(entry.sha256)
      if (current !== generation.current) return
      await openOriginal(original.blob, original.name, original)
    } catch (error) {
      if (current === generation.current) { setNotice(messageOf(error)); setIsError(true); setBusy(false) }
    }
  }
  async function saveCurrent() {
    if (!opened) return
    const selection = opened
    setBusy(true)
    try {
      const result = await retainArchive(selection.blob, selection.entry)
      setOpened(current => current === selection ? { ...selection, entry: result.entry, saved: true } : current)
      setNotice("Complete original saved in this browser."); setIsError(false)
      await refreshShelf()
    } catch (error) { setNotice(messageOf(error)); setIsError(true) }
    finally { setBusy(false) }
  }
  function closeArchive() {
    generation.current++; setOpened(null); setDetail(null); setBusy(false)
    setNotice("Archive closed. Saved originals remain available below."); setIsError(false)
  }
  const range = useMemo(() => {
    try {
      const lo = ledgerInput(from), hi = ledgerInput(through)
      if (lo !== undefined && hi !== undefined && lo > hi) throw new Error("The first ledger must not follow the last ledger.")
      return { from: lo, through: hi, error: null }
    } catch (error) { return { from: undefined, through: undefined, error: messageOf(error) } }
  }, [from, through])
  const inRange = (ledger: number) =>
    !range.error && (range.from === undefined || ledger >= range.from) && (range.through === undefined || ledger <= range.through)
  const overlaps = (first: number, last: number) =>
    !range.error && (range.from === undefined || last >= range.from) && (range.through === undefined || first <= range.through)
  const show = (title: string, value: unknown) => setDetail({ title, value })
  const inspectEvents = (title: string, ids: readonly string[], record: unknown) => {
    if (!opened) return
    const events = opened.report.events.filter(event => ids.includes(event.id))
    const sourceIds = new Set(events.map(event => event.sourceId))
    show(title, {
      record, events, sources: opened.archive.sources.filter(source => sourceIds.has(source.id)),
      archiveId: opened.archive.id, archiveSha256: opened.archive.sha256, binding: opened.archive.binding,
    })
  }
  const eventButton = (event: HistoryEvent) =>
    <button type="button" className={styles.link} onClick={() => inspectEvents("Original event " + event.id, [event.id], event)}>{event.id}</button>
  const evidenceButton = (title: string, ids: readonly string[], row: unknown) =>
    <button type="button" onClick={() => inspectEvents(title, ids, row)}>Open {ids.length} original event{ids.length === 1 ? "" : "s"}</button>
  const episodes = (report?.requests ?? []).filter(row =>
    !controllerError && overlaps(row.firstLedger, row.lastLedger) && (!controller || row.controller === controller) && jsonContains(row, search))
  const events = (report?.events ?? []).filter(row =>
    !controllerError && inRange(row.ledger) && (!controller || hasExactAddress([row.topics, row.data], controller)) && jsonContains(row, search))
  const valuations = (report?.valuations ?? []).filter(row => inRange(row.ledger) && jsonContains(row, search))
  const treasury = (report?.treasury ?? []).filter(row => inRange(row.ledger) && jsonContains(row, search))
  const windDown = (report?.windDown ?? []).filter(row =>
    !controllerError && inRange(row.ledger) && (!controller || hasExactAddress([row.topics, row.data], controller)) && jsonContains(row, search))
  const epochs = (report?.epochs ?? []).filter(row => {
    const related = report?.events.filter(event => row.eventIds.includes(event.id)) ?? []
    return !range.error && (related.length ? related.some(event => inRange(event.ledger)) : !from && !through) && jsonContains(row, search)
  })
  const coverage = (report?.coverage ?? []).filter(row => overlaps(row.fromLedger, row.toLedger))
  const controllers = useMemo(() => [...new Set(report?.requests.map(row => row.controller) ?? [])].sort(), [report])
  const statement = useMemo<{ value: InvestorStatement | null; error: string | null }>(() => {
    if (!report || !controller || range.error || controllerError) return { value: null, error: controllerError ?? range.error }
    try {
      const selection: StatementSelection = { controller }
      if (range.from !== undefined) selection.fromLedger = range.from
      if (range.through !== undefined) selection.toLedger = range.through
      return { value: investorStatement(report, selection), error: null }
    } catch (error) { return { value: null, error: messageOf(error) } }
  }, [report, controller, range, controllerError])
  const activeMismatch = report ? [
    ...(report.binding.network.passphrase !== network.passphrase ? ["network passphrase"] : []),
    ...CONTRACT_LABELS.filter(([role, label]) => contractRows.find(row => row.label === label)?.address !== report.binding.contracts[role]).map(([, label]) => label),
  ] : []
  const resetKey = [opened?.entry.sha256, section, search, controller, from, through].join("|")
  function exportSection() {
    if (!report) return
    csvDownload(reportCSV(report, section), "strata-" + section + "-complete.csv")
  }
  const requestTable = (rows: readonly RequestEpisode[], key: string) => <HistoryTable
    rows={rows} rowKey={row => row.id} resetKey={key}
    empty="No retained request episodes match this selection."
    columns={[
      { label: "Request episode", render: row => <><div>{row.side === "deposit" ? "Subscription" : "Redemption"} · epoch {row.epoch}</div><div className={styles.mono}>{row.controller}</div><span className={styles.tag}>{statusLabel(row.status)}</span></> },
      { label: "Requested", render: row => <><ExactValue value={row.side === "deposit" ? row.amount : row.shares} decimals={row.side === "deposit" ? undefined : 7} unit={row.side === "deposit" ? "asset atoms" : "shares"} /><div>{timestamp(row.requestedAt)}</div></> },
      { label: "Assets / shares in episode", render: row => <><div><ExactValue value={row.assets} unit="asset atoms" /></div><div><ExactValue value={row.shares} decimals={7} unit="shares" /></div></> },
      { label: "Price", render: row => <ExactValue value={row.sharePrice} decimals={18} unit="asset atoms / share atom" /> },
      { label: "History", render: row => <><div>Ledgers {row.firstLedger}–{row.lastLedger}</div>{row.missingStart && <strong>Earlier request event missing</strong>}{row.notes.map((note, i) => <p key={i}>{note}</p>)}{evidenceButton("Request episode " + row.id, row.eventIds, row)}</> },
    ]}
  />

  return <div className={styles.page}>
    <header className={styles.heading}>
      <div><h1>Vault history and statements</h1><p className={styles.subheading}>Retained requests, valuations, claims and treasury movements for one selected vault.</p></div>
      {opened && <div className={styles.actions}>
        <button type="button" onClick={() => downloadOriginal(opened.blob, opened.entry.name)}>Download original archive</button>
        <button type="button" onClick={() => downloadJSON(opened.report, "strata-servicing-report.json")}>Download full report</button>
        <button type="button" onClick={closeArchive}>Close archive</button>
      </div>}
    </header>
    <p className={styles.status} data-error={isError} role={isError ? "alert" : "status"} aria-live="polite">{notice}</p>
    <section className={styles.panel} aria-labelledby="archive-heading">
      <div className={styles.panelHead}><h2 id="archive-heading">Open an archive</h2><button type="button" disabled={busy} onClick={() => void refreshShelf()}>Refresh saved originals</button></div>
      <p>Choose the complete JSON export from the servicing collector. Every archive includes its original observations and coverage. Opening it creates a separate saved original in this browser.</p>
      <input ref={fileInput} type="file" accept=".json,application/json" className={styles.fileInput} aria-label="Complete servicing archive JSON" disabled={busy} onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ""
        if (file) void openOriginal(file, file.name)
      }} />
      {archives.length > 0 && <details className={styles.details}>
        <summary>{archives.length} saved original{archives.length === 1 ? "" : "s"}</summary>
        <div className={styles.shelf}><ul className={styles.shelfList}>{archives.map(entry => <li key={entry.sha256}>
          <button type="button" className={styles.rowButton} disabled={busy} onClick={() => void reopen(entry)}>
            <strong>{entry.name}</strong><span>{entry.bytes.toLocaleString()} bytes · opened {entry.importedAt}</span><span className={styles.mono}>{entry.sha256}</span>
          </button>
        </li>)}</ul></div>
      </details>}
    </section>

    {opened && report && <>
      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Selected original</h2>{!opened.saved && <button type="button" disabled={busy} onClick={() => void saveCurrent()}>Save this original again</button>}</div>
        <dl className={styles.identity}>
          <dt>Archive</dt><dd>{opened.entry.name} · {opened.entry.bytes.toLocaleString()} bytes</dd>
          <dt>Network</dt><dd>{report.binding.network.id} · {report.binding.network.passphrase}</dd>
          <dt>Vault</dt><dd className={styles.mono}>{report.binding.contracts.async_vault}</dd>
          <dt>Collection begins</dt><dd>Ledger {report.binding.startLedger}</dd>
          <dt>Archive created</dt><dd>{timestamp(opened.archive.createdAt)}</dd>
          <dt>Original file SHA-256</dt><dd className={styles.mono}>{opened.entry.sha256}</dd>
        </dl>
        {activeMismatch.length > 0 && <p className={styles.binding}>This archive differs from the application’s current {activeMismatch.join(", ")}. All history on this page uses the selected archive above.</p>}
        <div className={styles.metrics}>
          <div className={styles.metric}><strong>{report.events.length.toLocaleString()}</strong><span>Retained events</span></div>
          <div className={styles.metric}><strong>{report.requests.length.toLocaleString()}</strong><span>Request episodes</span></div>
          <div className={styles.metric}><strong>{report.valuations.length.toLocaleString()}</strong><span>Observed valuations</span></div>
          <div className={styles.metric}><strong>{report.coverage.filter(row => row.status !== "COMPLETE").length.toLocaleString()}</strong><span>Incomplete ranges and gaps</span></div>
        </div>
        {report.warnings.length > 0 && <details className={styles.details} open><summary>History notes ({report.warnings.length})</summary><ul className={styles.list}>{report.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
      </section>
      <nav className={styles.tabs} aria-label="History sections">{SECTIONS.map(([id, label]) => <button type="button" key={id} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>{label}</button>)}</nav>
      <section className={styles.panel} aria-label="History selection">
        <div className={styles.fields}>
          <label className={styles.field}>Investor / controller
            <input value={controller} onChange={event => setController(event.target.value.trim())} list="history-controllers" placeholder="All accounts" spellCheck={false} />
            <datalist id="history-controllers">{controllers.map(account => <option key={account} value={account} />)}</datalist>
            <small>Exact address; applied to activity, requests and wind-down.</small>
          </label>
          <label className={styles.field}>First ledger<input inputMode="numeric" value={from} onChange={event => setFrom(event.target.value)} placeholder="First retained ledger" /></label>
          <label className={styles.field}>Last ledger<input inputMode="numeric" value={through} onChange={event => setThrough(event.target.value)} placeholder="Last retained ledger" /></label>
          <label className={styles.field}>Find in displayed records<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Event, epoch, transaction or text" /></label>
        </div>
        {range.error && <p role="alert" className={styles.status}>{range.error}</p>}
        {controllerError && <p role="alert" className={styles.status}>{controllerError}</p>}
        <div className={styles.actions}><button type="button" onClick={() => { setSearch(""); setController(""); setFrom(""); setThrough("") }}>Clear filters</button><button type="button" onClick={exportSection}>Download complete section CSV</button></div>
        <p className={styles.downloadNote}>Section CSV contains the complete selected archive’s section. Investor statement downloads below use the selected account and ledger range.</p>
      </section>

      {section === "activity" && <section className={styles.panel}><h2>Recorded activity</h2>
        <HistoryTable rows={events} rowKey={row => row.id} resetKey={resetKey} empty="No retained events match this selection." columns={[
          { label: "Event", render: row => <><strong>{row.name}</strong><div>{row.role.replaceAll("_", " ")}</div>{eventButton(row)}</> },
          { label: "Ledger / time", render: row => <>{row.ledger}<div>{timestamp(row.closedAt)}</div></> },
          { label: "Transaction", render: row => <span className={styles.mono}>{row.txHash}</span> },
          { label: "Decoded data", render: row => row.decodeError ? <strong>{row.decodeError}</strong> : <button type="button" onClick={() => inspectEvents(row.name + " original data", [row.id], row)}>Open decoded data and original XDR</button> },
        ]} />
      </section>}

      {section === "requests" && <>
        <section className={styles.panel}><h2>Request episodes</h2><p>A cancellation followed by a new request remains a separate episode, including within the same epoch. Asset amounts are original indivisible units (atoms); share quantities use the current share contract’s seven decimals.</p>{requestTable(episodes, resetKey)}</section>
        <section className={styles.panel}><h2>Investor statement</h2>
          {!controller && <p className={styles.empty}>Enter an investor / controller address to prepare its statement.</p>}
          {statement.error && <p role="alert" className={styles.status}>{statement.error}</p>}
          {statement.value && <>
            <p className={styles.mono}>{statement.value.selection.controller}</p>
            <p>Ledgers {statement.value.selection.fromLedger ?? "first retained"}–{statement.value.selection.toLedger ?? "last retained"}. The statement carries the exact vault, source archive and coverage alongside the selected records.</p>
            <div className={styles.fields}>{Object.entries(statement.value.totals).map(([label, value]) => <div className={styles.metric} key={label}><span>{label.replace(/([A-Z])/g, " $1").toLowerCase()}</span><ExactValue value={value} decimals={SHARE_TOTALS.has(label) ? 7 : undefined} unit={SHARE_TOTALS.has(label) ? "shares" : "asset atoms"} /></div>)}</div>
            {statement.value.warnings.length > 0 && <ul className={styles.list}>{statement.value.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => statement.value && downloadOriginal(new Blob([statementHTML(statement.value)], { type: "text/html;charset=utf-8" }), "strata-investor-statement.html")}>Download printable statement</button>
              <button type="button" onClick={() => downloadJSON(statement.value, "strata-investor-statement.json")}>Download statement JSON</button>
              <button type="button" onClick={() => statement.value && csvDownload(statementCSV(statement.value), "strata-investor-statement.csv")}>Download statement CSV</button>
              <button type="button" onClick={() => show("Complete investor statement", statement.value)}>Inspect complete statement</button>
            </div>
          </>}
        </section>
      </>}

      {section === "valuations" && <section className={styles.panel}><h2>Observed valuations</h2><p>Prices are exact asset-atoms per share-atom ratios with an 18-decimal WAD scale. Each attestation retains its own time, expiry and original event.</p>
        <HistoryTable rows={valuations} rowKey={row => row.id} resetKey={resetKey} empty="No retained valuation events match this selection." columns={[
          { label: "Price", render: row => <ExactValue value={row.price} decimals={18} unit="asset atoms / share atom" /> },
          { label: "Attester", render: row => <span className={styles.mono}>{row.attester}</span> },
          { label: "Observed on chain", render: row => <>{timestamp(row.closedAt)}<div>Ledger {row.ledger}</div></> },
          { label: "Expires", render: row => timestamp(row.expiresAt) },
          { label: "Original", render: row => evidenceButton("Valuation " + row.id, row.eventIds, row) },
        ]} />
      </section>}

      {section === "epochs" && <section className={styles.panel}><h2>Epoch history</h2><p>Aggregate pricing and individual payments remain separate. A missing request event cannot be reconstructed from an aggregate total.</p>
        <HistoryTable rows={epochs} rowKey={row => row.id} resetKey={resetKey} empty="No retained epochs match this selection." columns={[
          { label: "Epoch", render: row => <>{row.id}<div className={styles.tag}>{statusLabel(row.status)}</div></> },
          { label: "Deposited asset atoms", render: row => <ExactValue value={row.totalDeposited} unit="atoms" /> },
          { label: "Shares redeeming", render: row => <ExactValue value={row.totalSharesRedeeming} decimals={7} /> },
          { label: "Price", render: row => <ExactValue value={row.sharePrice} decimals={18} unit="asset atoms / share atom" /> },
          { label: "Closed / priced", render: row => <>{timestamp(row.closedAt)}<div>{timestamp(row.pricedAt)}</div></> },
          { label: "Original", render: row => evidenceButton("Epoch " + row.id, row.eventIds, row) },
        ]} />
      </section>}

      {section === "treasury" && <>
        <section className={styles.panel}><h2>Treasury movements</h2><p>Net deployed is the contract’s signed movement counter. It can be negative and does not state the market value of an off-chain asset.</p>
          <HistoryTable rows={treasury} rowKey={row => row.id} resetKey={resetKey} empty="No retained treasury movements match this selection." columns={[
            { label: "Movement", render: row => <>{statusLabel(row.direction)}<div className={styles.mono}>{row.account}</div></> },
            { label: "Asset atoms", render: row => <ExactValue value={row.assets} unit="atoms" /> },
            { label: "Net deployed", render: row => <ExactValue value={row.netDeployed} unit="asset atoms" /> },
            { label: "Ledger / time", render: row => <>{row.ledger}<div>{timestamp(row.closedAt)}</div></> },
            { label: "Original", render: row => evidenceButton("Treasury movement " + row.id, row.eventIds, row) },
          ]} />
        </section>
        <section className={styles.panel}><h2>Treasury reconciliation</h2><p>Each comparison uses two original state snapshots and the retained movements between them.</p>
          <HistoryTable rows={report.reconciliations.filter(row => overlaps(row.fromLedger, row.toLedger) && jsonContains(row, search))} rowKey={row => row.id} resetKey={resetKey} empty="Two comparable retained state snapshots are needed for reconciliation." columns={[
            { label: "Range", render: row => <>{row.fromLedger}–{row.toLedger}<div className={styles.tag}>{statusLabel(row.status)}</div></> },
            { label: "Opening / closing", render: row => <><ExactValue value={row.openingNetDeployed} unit="asset atoms" /><div><ExactValue value={row.closingNetDeployed} unit="asset atoms" /></div></> },
            { label: "Deployed / funded", render: row => <><ExactValue value={row.observedDeployed} unit="asset atoms" /><div><ExactValue value={row.observedFunded} unit="asset atoms" /></div></> },
            { label: "Difference", render: row => <ExactValue value={row.difference} unit="asset atoms" /> },
            { label: "Explanation", render: row => <>{row.reason}<div><button type="button" onClick={() => {
              const snapshotIds = new Set([row.fromSnapshotId, row.toSnapshotId])
              const snapshots = report.snapshots.filter(snapshot => snapshotIds.has(snapshot.id))
              const originalSnapshots = opened.archive.snapshots.filter(snapshot => snapshotIds.has(snapshot.id))
              const ids = new Set([...originalSnapshots.flatMap(snapshot => [snapshot.networkSourceId, snapshot.sourceId]), ...report.events.filter(event => row.eventIds.includes(event.id)).map(event => event.sourceId)])
              show("Complete reconciliation", { reconciliation: row, snapshots, originalSnapshots, events: report.events.filter(event => row.eventIds.includes(event.id)), sources: opened.archive.sources.filter(source => ids.has(source.id)), binding: report.binding })
            }}>Open original comparison</button></div></> },
          ]} />
        </section>
        <section className={styles.panel}><h2>Wind-down history</h2><HistoryTable rows={windDown} rowKey={row => row.id} resetKey={resetKey} empty="No retained wind-down events match this selection." columns={[
          { label: "Event", render: row => <>{row.name}<div>{eventButton(row)}</div></> },
          { label: "Ledger / time", render: row => <>{row.ledger}<div>{timestamp(row.closedAt)}</div></> },
          { label: "Transaction", render: row => <span className={styles.mono}>{row.txHash}</span> },
        ]} /></section>
      </>}

      {section === "coverage" && <>
        <section className={styles.panel}><h2>Retained ledger ranges</h2><p>Complete means the collector finished that selected range. Earlier deployment history and any incomplete or missing ranges remain visible in the archive.</p>
          <HistoryTable rows={coverage} rowKey={row => row.fromLedger + ":" + row.toLedger + ":" + row.batchIds.join(",")} resetKey={resetKey} empty="No coverage intervals match this selection." columns={[
            { label: "Ledgers", render: row => <>{row.fromLedger}–{row.toLedger}</> },
            { label: "Coverage", render: row => <span className={styles.tag}>{statusLabel(row.status)}</span> },
            { label: "Reason", render: row => row.reason ?? "Selected range completed" },
            { label: "Original batches", render: row => <button type="button" onClick={() => {
              const batches = opened.archive.batches.filter(batch => row.batchIds.includes(batch.id))
              const ids = new Set(batches.flatMap(batch => [batch.networkSourceId, batch.healthSourceId, ...batch.sourceIds]))
              show("Coverage and original RPC responses", { coverage: row, batches, sources: opened.archive.sources.filter(source => ids.has(source.id)), binding: report.binding })
            }}>Open {row.batchIds.length} batches</button> },
          ]} />
        </section>
        <section className={styles.panel}><h2>Original state snapshots</h2>
          <HistoryTable rows={report.snapshots.filter(row => inRange(row.ledger) && jsonContains(row, search))} rowKey={row => row.id} resetKey={resetKey} empty="No retained state snapshots match this selection." columns={[
            { label: "Snapshot", render: row => row.label },
            { label: "Ledger / observation", render: row => <>{row.ledger}<div>{row.observedAt}</div></> },
            { label: "Entries", render: row => row.entries.length },
            { label: "Original", render: row => <button type="button" onClick={() => {
              const originalSnapshot = opened.archive.snapshots.find(snapshot => snapshot.id === row.id)
              const ids = new Set([row.sourceId, originalSnapshot?.networkSourceId])
              show(row.label, { snapshot: row, originalSnapshot, sources: opened.archive.sources.filter(source => ids.has(source.id)), binding: report.binding })
            }}>Open complete snapshot</button> },
          ]} />
        </section>
        <section className={styles.panel}><h2>Selected network and contracts</h2><dl className={styles.identity}>
          <dt>RPC endpoint</dt><dd>{report.binding.network.rpcUrl}</dd>
          <dt>Network passphrase</dt><dd>{report.binding.network.passphrase}</dd>
          {CONTRACT_LABELS.map(([role, label]) => <div key={role} style={{ display: "contents" }}><dt>{label}</dt><dd className={styles.mono}>{report.binding.contracts[role]}</dd></div>)}
          <dt>Contract source commit</dt><dd className={styles.mono}>{report.binding.sourceCommit}</dd>
          <dt>Archive content identity</dt><dd className={styles.mono}>{report.archiveSha256}</dd>
        </dl></section>
        <section className={styles.panel}><h2>Original RPC observations</h2>
          <HistoryTable rows={report.sources.filter(row => jsonContains(row, search))} rowKey={row => row.id} resetKey={resetKey} empty="No source observations match this search." columns={[
            { label: "Source", render: row => <>{row.method}<div className={styles.mono}>{row.id}</div></> },
            { label: "Observed", render: row => row.observedAt },
            { label: "Original bytes", render: row => row.bytes.toLocaleString() },
            { label: "SHA-256", render: row => <span className={styles.mono}>{row.sha256}</span> },
            { label: "Original", render: row => <button type="button" onClick={() => show("Original RPC request and response", opened.archive.sources.find(source => source.id === row.id))}>Open full source</button> },
          ]} />
        </section>
        {opened.archive.notes.length > 0 && <section className={styles.panel}><h2>Original archive notes</h2>{opened.archive.notes.map(note => <div key={note.id}><strong>{note.recordedAt}</strong><p>{note.text}</p></div>)}</section>}
      </>}
    </>}
    {detail && <OriginalDetails key={detail.title} title={detail.title} value={detail.value} onClose={() => setDetail(null)} />}
  </div>
}
