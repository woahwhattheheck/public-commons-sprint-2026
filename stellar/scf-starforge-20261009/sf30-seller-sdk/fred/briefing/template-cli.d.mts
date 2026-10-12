export type FredTemplateCommand = 'template-save' | 'templates' | 'successor-preview' | 'successor-save' | 'successor' | 'successor-file';
export declare const FRED_TEMPLATE_COMMANDS: readonly FredTemplateCommand[];
export declare const FRED_TEMPLATE_USAGE: string;
/** Executes against the original retained project and returns the result without printing. */
export declare function runFredTemplateCommand(args: string[]): Promise<unknown>;
export declare function main(args?: string[]): Promise<unknown>;
