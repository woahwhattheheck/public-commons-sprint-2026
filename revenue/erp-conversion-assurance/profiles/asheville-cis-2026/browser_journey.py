#!/usr/bin/env python3
"""MIT. One real local operator/browser continuation; uses the existing Playwright/Chromium installation."""
import csv,hashlib,json,os,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
def main():
    url,scenario_path,output=sys.argv[1:4]
    readonly=len(sys.argv)>4 and sys.argv[4]=='read-only'
    scenario=json.loads(Path(scenario_path).read_text());out=Path(output);out.mkdir(mode=0o700,parents=True,exist_ok=False)
    result={'schema':'asheville.actual-browser.v1','mode':'read-only restoration' if readonly else 'original operator continuation','steps':[]}
    errors=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('UTILITY_CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        try:
            context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
            page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(url,wait_until='domcontentloaded')
            page.wait_for_function("!document.body.hasAttribute('aria-busy') && document.querySelector('button[data-view=profile]')")
            page.get_by_role('button',name='Utility operator',exact=True).click()
            ut=page.locator('.ut');expect(ut.get_by_role('heading',name='Utility conversion operator',exact=True)).to_be_visible(timeout=30000)
            def idle():
                page.wait_for_function("document.querySelector('.ut') && !document.querySelector('.ut').inert")
            def section(title):
                return ut.locator('section.ut-section').filter(has=page.get_by_role('heading',name=title,exact=True))
            idle();ut.get_by_label('Choose utility project').select_option(scenario['projectId']);idle()
            ut.get_by_label('Utility operator or reviewer').fill('Practice browser operator')
            ut.get_by_role('button',name='Sources & mapping',exact=True).click();idle()
            ut.get_by_role('button',name='Open '+scenario['accountDatasetId'][:8]+'…',exact=True).click();idle()
            ut.get_by_label('Search dataset',exact=True).fill('000000005000');ut.get_by_role('button',name='Search',exact=True).click();idle()
            expect(ut.get_by_text('Practice 5000',exact=True)).to_be_visible();result['steps'].append('retained 5000-account source searched through actual UI')
            if not readonly:
                ut.get_by_role('button',name='Correct',exact=True).click()
                expect(ut.get_by_role('heading',name='Correct source record 5000')).to_be_visible()
                ut.get_by_label('phone',exact=True).fill('555-0999')
                ut.get_by_label('Correction reason',exact=True).fill('Practice browser correction; preserve the original source row.')
                ut.get_by_role('button',name='Save corrected dataset version',exact=True).click();idle()
                with page.expect_download() as event:
                    ut.get_by_role('button',name='Download mapped CSV',exact=True).click()
                download=event.value;path=out/'corrected-account-export.csv';download.save_as(path)
                records=list(csv.DictReader(path.open(newline='')))
                assert len(records)==5000 and next(r for r in records if r['account_id']=='000000005000')['phone']=='555-0999'
                result['steps'].append('actual source-record correction and 5000-row mapped CSV download')
                source=section('Import a source export')
                source.get_by_label('Utility table type',exact=True).select_option('addresses');idle()
                source=section('Import a source export')
                source.get_by_label('Original file',exact=True).set_input_files(str(Path(scenario['fixtures'])/'browser-addresses.csv'))
                expect(ut.locator('.ut-status')).to_contain_text('inspected',timeout=30000);idle()
                section('Import a source export').get_by_role('button',name='Retain mapped source',exact=True).click();idle()
                expect(ut.locator('.ut-status')).to_contain_text('2 records retained')
                result['steps'].append('actual original file upload, observed-column mapping and source retention')
            for tab,title in [('Meter reads','Meter reads and native handheld files'),('Billing','Parallel billing'),('Payments','Payment and bank reconciliation'),('Collections','Collections and account actions'),('Field routes','Field routes and offline work'),('Delivery','Review, portable handoff and recovery')]:
                ut.get_by_role('button',name=tab,exact=True).click();idle()
                # The heading must exist; retained body and controls must render without script exceptions.
                assert ut.locator('.ut-content h2').count()==1
                result['steps'].append('actual '+tab+' view')
            ut.get_by_role('button',name='Billing',exact=True).click();idle()
            choose=section('Retained candidate runs').locator('select');options=choose.locator('option').evaluate_all("(nodes)=>nodes.map(n=>n.value).filter(Boolean)")
            assert scenario['billingId'] in options,'The original complete billing candidate is absent from the retained-run selector.'
            choose.select_option(scenario['billingId'])
            section('Retained candidate runs').get_by_role('button',name='Open retained operation',exact=True).click();idle()
            expect(ut.get_by_text('509750.00',exact=True)).to_be_visible()
            page.screenshot(path=str(out/'operator-desktop.png'),full_page=False)
            page.set_viewport_size({'width':390,'height':844})
            ut.get_by_role('button',name='Overview',exact=True).click();idle()
            expect(ut.get_by_role('heading',name='Project overview',exact=True)).to_be_visible()
            overflow=page.evaluate('document.documentElement.scrollWidth > window.innerWidth + 2')
            assert not overflow,'The mobile operator viewport has page-level horizontal overflow.'
            page.screenshot(path=str(out/'operator-mobile.png'),full_page=False);result['steps'].append('390-pixel mobile operator continuation')
            field=context.new_page();field.goto(Path(scenario['fieldPath']).resolve().as_uri(),wait_until='domcontentloaded')
            expect(field.locator('article')).to_have_count(2)
            field.screenshot(path=str(out/'offline-field.png'),full_page=False)
            if not readonly:
                order=field.locator('article').first
                order.get_by_label('Visit result',exact=True).select_option('Completed')
                order.get_by_label('Reason',exact=True).select_option('Completed')
                order.get_by_label('Visit notes',exact=True).fill('Practice offline browser return with the original attached PNG.')
                order.get_by_label('Original JPEG / PNG photographs',exact=True).set_input_files(str(Path(scenario['fixtures'])/'practice-photo.png'))
                expect(field.locator('#status')).to_contain_text('Photographs attached',timeout=30000)
                with field.expect_download() as event:
                    field.locator('#download').click()
                path=out/'offline-return-from-browser.json';event.value.save_as(path)
                returned=json.loads(path.read_text());assert returned['schema']=='asheville.field-return.v1' and len(returned['results'])==1 and len(returned['results'][0]['photos'])==1
                result['steps'].append('real offline reason/photo entry and downloaded native return')
            else:result['steps'].append('original retained offline route rendered after cold restoration')
            field.close();page.close();context.close()
        except Exception as error:
            result['status']='FAILED';result['error']=str(error);result['scriptErrors']=errors
            if 'page' in locals() and not page.is_closed():
                try:
                    page.screenshot(path=str(out/'operator-failed.png'),full_page=False)
                    result['failureScreenshot']=str(out/'operator-failed.png')
                except Exception:
                    pass
            (out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
            raise
        finally:browser.close()
    assert not errors,'Actual browser script errors: '+json.dumps(errors)
    result['status']='PASS';result['screenshots']=[str(out/n) for n in ['operator-desktop.png','operator-mobile.png','offline-field.png']]
    (out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
if __name__=='__main__':
    main()
