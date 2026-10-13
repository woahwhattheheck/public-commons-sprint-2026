# English and French completion

Use **Language / Langue** on the operator, respondent or companies and communications screen to choose **English** or **Français**. The interface changes immediately. The selected language is saved with the original workspace’s operator access or the individual respondent’s access and is restored when that session opens again.

During a language switch, the same answer controls remain open. Entered decimal values, stored choice keys, protected/public disclosure selections, public alternative text, confirmations, expanded details, the current question page and selected upload files stay in place. Report template edits, selected editions, filters and unsent contact or communication forms also stay in place. **Save progress / Enregistrer la progression** retains a respondent’s entered answers for reopening.

Text inputs use the active `en-CA` or `fr-CA` language and browser spelling support. The browser’s corresponding spelling dictionary supplies its suggestions. Decimal, date, email, password and definition-JSON fields retain their respective input behaviour.

## Display wording

Open **Definitions / Définitions**, select the original questionnaire, and use **French display wording / Libellés d’affichage en français**. An operator can enter a French display title, question labels, table-column labels and choice labels. The original wording is shown beside each edit. Twenty questions are shown at a time, with previous/next controls; the entire edition can be edited and saved.

Choice labels keep their original stored values. A displayed **Distributeur**, for example, continues to store the original `Distributor` key. Entered response text and public alternatives retain the respondent’s own language and wording.

Display wording is pinned to the exact original questionnaire and definition version. Saving appends an immutable wording version with an optimistic version check, original native request replay and journal history in the same SQLite database. A later definition edition has its own wording. The original workbooks, source-cell bindings, accepted revisions and frozen reports remain available in their original history.

The full original workbook compiler supplies original question stems, section headings, row labels and any retained French source text. Respondent pages display a complete original stem once per source group, followed by its fields; a page beginning inside that group repeats its context. French group text comes from the retained source. Individual labels use separately authored wording, or an original French text when it corresponds to that individual prompt. This keeps a shared group instruction distinct from a row label such as a country or year.

Original family pages also use the source-owned display definition to show the full year and partial-year column headings, measure, country and subgroup context. The corresponding original French row labels and context stay separate from authored wording. Read-only totals retain their original period context. Resolving this presentation keeps the publication's answer schema, source coordinates, current values and historical reports intact.

Certification prompts include their original Yes/No or Oui/Non branch. The original workbook's `X` marker remains the stored answer key; the displayed option uses that source row's exact English or French wording. Original exporter group headings stay visible, while entered exporter names remain answer data with their own disclosure.

## Reports and communications

Reporting controls support both interface languages. Saved templates and frozen report content retain their authored titles, notes, native values and disclosure-specific statistics. The current customer example is **Trade questionnaire response report**, template version 5, using the six explicitly selected entered demonstration responses. Its ordered sections and public/protected editions remain accessible through HTML, CSV, JSON, PDF, Word, Excel and PowerPoint downloads.

The interface-language preference is independent of a company contact’s communication language. The contact’s retained EN/FR value continues to select its authored invitation, confirmation, revision-request and reminder templates. The UI language can change while those contact fields or message templates are being edited.

The original template download links return exact retained workbook bytes and are scoped to the authenticated respondent’s published source-workbook list. Operator access retains the whole source collection.

This programme implements the language controls requested in the original ATSSC Annex A, page 20: 6.1.18, 6.1.19, 6.2.20 and 6.2.21. It joins the original questionnaire workspace and source-owned reporting and communications extensions.
