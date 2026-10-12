/** MIT. Explicit saved component versions in the original Python document intake. */
import type {ComponentSourceStore,RetainedComponentEdition,ComponentSelection,ComponentChoice,
  ComponentDescriptor,ComponentStream} from './components.mjs';
import type {AnalysisVersion,AnalysisPythonComponentSelection} from './types.mjs';
export const PYTHON_COMPONENT_INTAKE_SCHEMA:'stellar-forge.sensorthings-python-component-intake.v1';
export const PYTHON_COMPONENT_BINDINGS_SCHEMA:'stellar-forge.sensorthings-python-component-bindings.v1';
export type PythonComponentTable='selected_components'|'component_index'|'component_eligibility'|'component_bindings';
export const PYTHON_COMPONENT_TABLES:Readonly<Record<PythonComponentTable,readonly string[]>>;
export interface PythonComponentBindings {
  schema:typeof PYTHON_COMPONENT_BINDINGS_SCHEMA;
  editionId:string;analysisVersionId:string;projectId:string;selection:ComponentSelection;
  bindings:Array<{choice:ComponentChoice;descriptor:ComponentDescriptor;bindingJson:string;
    stream:Omit<ComponentStream,'components'|'kind'|'things'|'sensors'|'locations'>}>;
  meaning:Readonly<Record<string,string>>;
  methods:Readonly<Record<string,string>>;
}
export interface PythonComponentProjection {
  metadata:AnalysisPythonComponentSelection;
  version:AnalysisVersion & {selection:ComponentSelection};
  manifest:PythonComponentBindings;
  tableColumns:typeof PYTHON_COMPONENT_TABLES;
  rows(table:PythonComponentTable):AsyncGenerator<{row:Record<string,string>}>;
}
export function prepareComponentProjection(store:ComponentSourceStore,edition:RetainedComponentEdition,
  version:AnalysisVersion & {selection:ComponentSelection}):Promise<PythonComponentProjection>;
