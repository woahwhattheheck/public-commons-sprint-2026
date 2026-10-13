import com.sun.star.beans.PropertyValue;
import com.sun.star.bridge.XUnoUrlResolver;
import com.sun.star.comp.helper.Bootstrap;
import com.sun.star.frame.XComponentLoader;
import com.sun.star.frame.XDesktop;
import com.sun.star.frame.XStorable;
import com.sun.star.lang.XComponent;
import com.sun.star.sheet.XCalculatable;
import com.sun.star.sheet.XSpreadsheetDocument;
import com.sun.star.sheet.XSpreadsheet;
import com.sun.star.sheet.XCellRangesQuery;
import com.sun.star.sheet.XFormulaQuery;
import com.sun.star.sheet.CellFlags;
import com.sun.star.sheet.XFormulaTokens;
import com.sun.star.sheet.FormulaToken;
import com.sun.star.sheet.SingleReference;
import com.sun.star.sheet.ComplexReference;
import com.sun.star.sheet.ReferenceFlags;
import com.sun.star.container.XIndexAccess;
import com.sun.star.container.XNamed;
import com.sun.star.table.CellRangeAddress;
import com.sun.star.uno.UnoRuntime;
import com.sun.star.uno.XComponentContext;
import com.sun.star.util.XCloseable;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/** Original XLSX calculation through the installed native LibreOffice engine.
 * The client connects only to the caller's fresh loopback-only office instance.
 * Workbook macros and linked-source updates remain disabled. */
public final class NativeWorkbookCalculation {
    static PropertyValue property(String name, Object value) {
        PropertyValue p = new PropertyValue(); p.Name = name; p.Value = value; return p;
    }
    static String quote(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (char c : value.toCharArray()) {
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c < 32) out.append(String.format("\\u%04x",(int)c));
            else out.append(c);
        }
        return out.append('"').toString();
    }
    static String column(int index) {
        String result = "";
        for (int number=index+1; number>0; number=(number-1)/26)
            result = (char)('A'+(number-1)%26)+result;
        return result;
    }
    static int[] reference(SingleReference ref,int sheet,int col,int row) {
        if ((ref.Flags & (ReferenceFlags.COLUMN_DELETED|ReferenceFlags.ROW_DELETED|ReferenceFlags.SHEET_DELETED))!=0)
            return null;
        return new int[] {(ref.Flags&ReferenceFlags.SHEET_RELATIVE)!=0 ? sheet+ref.RelativeSheet : ref.Sheet,
            (ref.Flags&ReferenceFlags.COLUMN_RELATIVE)!=0 ? col+ref.RelativeColumn : ref.Column,
            (ref.Flags&ReferenceFlags.ROW_RELATIVE)!=0 ? row+ref.RelativeRow : ref.Row};
    }
    static void precedents(XComponent document, Path destination) throws Exception {
        XIndexAccess sheets = UnoRuntime.queryInterface(XIndexAccess.class,
            UnoRuntime.queryInterface(XSpreadsheetDocument.class,document).getSheets());
        String[] names = new String[sheets.getCount()];
        for (int i=0;i<names.length;i++) names[i]=UnoRuntime.queryInterface(XNamed.class,sheets.getByIndex(i)).getName();
        StringBuilder json = new StringBuilder("{\"schema\":\"atssc.native-precedents.v2\",\"operation\":\"com.sun.star.sheet.XFormulaTokens.getTokens\",\"formulas\":[");
        boolean first = true;
        for (int index=0;index<names.length;index++) {
            XSpreadsheet sheet = UnoRuntime.queryInterface(XSpreadsheet.class,sheets.getByIndex(index));
            CellRangeAddress[] formulas = UnoRuntime.queryInterface(XCellRangesQuery.class,sheet)
                .queryContentCells((short)CellFlags.FORMULA).getRangeAddresses();
            for (CellRangeAddress range : formulas)
                for (int row=range.StartRow;row<=range.EndRow;row++)
                    for (int col=range.StartColumn;col<=range.EndColumn;col++) {
                        if (!first) json.append(','); first=false;
                        json.append("{\"sheet\":").append(quote(names[index]))
                            .append(",\"cell\":").append(quote(column(col)+(row+1)))
                            .append(",\"native_error_code\":").append(sheet.getCellByPosition(col,row).getError())
                            .append(",\"ranges\":[");
                        FormulaToken[] tokens = UnoRuntime.queryInterface(XFormulaTokens.class,sheet.getCellByPosition(col,row)).getTokens();
                        boolean firstRef = true; int invalid=0;
                        for (FormulaToken token : tokens) {
                            SingleReference a = null, b = null;
                            if (token.Data instanceof SingleReference) a=b=(SingleReference)token.Data;
                            else if (token.Data instanceof ComplexReference) {
                                a=((ComplexReference)token.Data).Reference1;b=((ComplexReference)token.Data).Reference2;
                            }
                            if (a==null) continue;
                            int[] left=reference(a,index,col,row),right=reference(b,index,col,row);
                            if (left==null || right==null) {invalid++;continue;}
                            for (int tab=Math.min(left[0],right[0]);tab<=Math.max(left[0],right[0]);tab++) {
                                if(tab<0 || tab>=names.length) {invalid++;continue;}
                                if(!firstRef) json.append(',');firstRef=false;
                                json.append("{\"sheet\":").append(quote(names[tab]))
                                    .append(",\"start_row\":").append(Math.min(left[2],right[2])+1).append(",\"end_row\":").append(Math.max(left[2],right[2])+1)
                                    .append(",\"start_column\":").append(Math.min(left[1],right[1])+1).append(",\"end_column\":").append(Math.max(left[1],right[1])+1).append('}');
                            }
                        }
                        json.append("],\"invalid_references\":").append(invalid).append('}');
                    }
        }
        Files.writeString(destination,json.append("]}\n").toString(),StandardCharsets.UTF_8);
    }
    public static void main(String[] arguments) throws Exception {
        if (arguments.length < 2 || arguments.length > 3) throw new IllegalArgumentException("UNO URL, job TSV and optional inspect mode are required");
        boolean inspectOnly = arguments.length==3 && arguments[2].equals("inspect");
        XComponentContext local = Bootstrap.createInitialComponentContext((Map<String,Object>)null);
        XUnoUrlResolver resolver = UnoRuntime.queryInterface(XUnoUrlResolver.class,
            local.getServiceManager().createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local));
        XComponentContext remote = null;
        for (int attempt=0; attempt<100 && remote==null; attempt++) {
            try { remote = UnoRuntime.queryInterface(XComponentContext.class, resolver.resolve(arguments[0])); }
            catch (com.sun.star.connection.NoConnectException waiting) { Thread.sleep(100); }
        }
        if (remote == null) throw new IllegalStateException("The owned office instance did not accept its UNO connection");
        Object desktop = remote.getServiceManager().createInstanceWithContext("com.sun.star.frame.Desktop", remote);
        XComponentLoader loader = UnoRuntime.queryInterface(XComponentLoader.class, desktop);
        PropertyValue[] input = {property("Hidden",true), property("ReadOnly",true),
            property("MacroExecutionMode",(short)0), property("UpdateDocMode",(short)0)};
        PropertyValue[] output = {property("FilterName","Calc MS Excel 2007 XML"), property("Overwrite",false)};
        // Keep this owned office instance alive between original documents.
        // Closing its last hidden document can otherwise race the next load.
        XComponent keeper = loader.loadComponentFromURL("private:factory/scalc","_blank",0,input);
        if(keeper==null) throw new IllegalStateException("Native desktop lifecycle guard did not open");
        int index = 0;
        Throwable failed = null;
        try {
            for (String line : Files.readAllLines(Path.of(arguments[1]), StandardCharsets.UTF_8)) {
                String[] parts = line.split("\t",-1);
                if (parts.length != 2) throw new IllegalArgumentException("Invalid native calculation job");
                System.out.println("BEGIN " + index); System.out.flush();
                XComponent document = loader.loadComponentFromURL(parts[0], "_blank", 0, input);
                if (document == null) throw new IllegalStateException("Native engine did not load the original workbook");
                try {
                    XCalculatable calculation = UnoRuntime.queryInterface(XCalculatable.class,document);
                    if (calculation == null) throw new IllegalStateException("Original document is not a spreadsheet");
                    if (!inspectOnly) {
                        calculation.calculateAll();
                        UnoRuntime.queryInterface(XStorable.class, document).storeToURL(parts[1], output);
                    }
                    precedents(document,Path.of(java.net.URI.create(parts[1]+".precedents.json")));
                } finally {
                    XCloseable close = UnoRuntime.queryInterface(XCloseable.class,document);
                    if (close == null) document.dispose(); else close.close(true);
                }
                System.out.println("COMPLETE " + index++); System.out.flush();
            }
        } catch (Throwable error) { failed=error; error.printStackTrace(System.err); }
        finally {
            try { UnoRuntime.queryInterface(XDesktop.class,desktop).terminate(); }
            catch (Throwable closing) { if(failed==null) {failed=closing;closing.printStackTrace(System.err);} }
        }
        if(failed!=null) System.exit(1);
        System.exit(0);
    }
}
