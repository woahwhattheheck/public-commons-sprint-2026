import { useEffect, useRef, useState, type ReactNode } from "react"
import { downloadJSON } from "./archiveStore"
import styles from "../pages/ServicingHistory.module.css"

export interface Column<Row> {
  label: string
  render: (row: Row) => ReactNode
}
export function HistoryTable<Row>({
  rows, columns, rowKey, empty, resetKey,
}: {
  rows: readonly Row[]
  columns: readonly Column<Row>[]
  rowKey: (row: Row) => string
  empty: string
  resetKey: string
}) {
  const [page, setPage] = useState(0)
  useEffect(() => { setPage(0) }, [resetKey])
  const count = 50
  const last = Math.max(0, Math.ceil(rows.length / count) - 1)
  const current = Math.min(page, last)
  if (!rows.length) return <p className={styles.empty}>{empty}</p>
  return <>
    <div className={styles.tableScroll} tabIndex={0} aria-label="Scrollable complete record table">
      <table className={styles.table}>
        <thead><tr>{columns.map((column, index) => <th scope="col" key={index}>{column.label}</th>)}</tr></thead>
        <tbody>{rows.slice(current * count, (current + 1) * count).map(row =>
          <tr key={rowKey(row)}>{columns.map((column, index) => <td key={index}>{column.render(row)}</td>)}</tr>
        )}</tbody>
      </table>
    </div>
    <div className={styles.pagination}>
      <span>{current * count + 1}–{Math.min((current + 1) * count, rows.length)} of {rows.length.toLocaleString()} records</span>
      <button type="button" disabled={!current} onClick={() => setPage(0)}>First</button>
      <button type="button" disabled={!current} onClick={() => setPage(current - 1)}>Previous</button>
      <button type="button" disabled={current >= last} onClick={() => setPage(current + 1)}>Next</button>
      <button type="button" disabled={current >= last} onClick={() => setPage(last)}>Last</button>
    </div>
  </>
}

export function ExactValue({ value, decimals, unit }: {
  value: string | null | undefined
  decimals?: number
  unit?: string
}) {
  if (value === null || value === undefined) return <span className={styles.muted}>Unobserved</span>
  let display = value
  if (decimals !== undefined && /^-?\d+$/.test(value)) {
    const negative = value.startsWith("-")
    const magnitude = negative ? value.slice(1) : value
    const whole = magnitude.padStart(decimals + 1, "0")
    const fraction = decimals ? whole.slice(-decimals).replace(/0+$/, "") : ""
    const integer = decimals ? whole.slice(0, -decimals) : whole
    display = (negative ? "-" : "") + integer.replace(/^0+(?=\d)/, "") + (fraction ? "." + fraction : "")
  }
  return <span className={styles.value} title={value + " original units"}>{display}{unit ? " " + unit : ""}</span>
}

export function OriginalDetails({ title, value, onClose }: {
  title: string
  value: unknown
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  const json = JSON.stringify(value, null, 2) ?? "null"
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="history-detail-title" onCancel={onClose}>
    <div className={styles.dialogHeader}>
      <h2 id="history-detail-title">{title}</h2>
      <button type="button" onClick={onClose}>Close</button>
    </div>
    <div className={styles.dialogBody}>
      <button type="button" onClick={() => downloadJSON(value, "strata-history-original.json")}>Download complete record JSON</button>
      {json.length <= 1_000_000
        ? <pre className={styles.json}>{json}</pre>
        : <p>This complete record is {new Blob([json]).size.toLocaleString()} bytes. Download the full JSON to open it in a file viewer.</p>}
    </div>
  </dialog>
}
