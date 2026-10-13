import * as stellar from "@stellar/stellar-sdk";
import {StellarWalletsKit} from "@creit.tech/stellar-wallets-kit/sdk";
import {FreighterModule} from "@creit.tech/stellar-wallets-kit/modules/freighter";
import {AlbedoModule} from "@creit.tech/stellar-wallets-kit/modules/albedo";
import {xBullModule} from "@creit.tech/stellar-wallets-kit/modules/xbull";
import {LobstrModule} from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import {RabetModule} from "@creit.tech/stellar-wallets-kit/modules/rabet";
import {WalletConnectModule} from "@creit.tech/stellar-wallets-kit/modules/wallet-connect";
import {createWalletsKitDriver} from "./bim-wallets.mjs";
import {createStellarSubmissionDriver} from "./stellar-submission.mjs";
import {mountMoneyGramWidget} from "./moneygram-widget.mjs";
import {NETWORKS,environment,need,copy,text} from "../lib/moneygram-core.mjs";
const constructors={freighter:FreighterModule,albedo:AlbedoModule,xbull:xBullModule,lobstr:LobstrModule,rabet:RabetModule};
let initialized=null,activeRuntime=null;
/**
 * Bundled with installed exact SDK16.0.1 / WalletsKit2.7.1. SDK-owned wallet sessions
 * live for the page. A runtime owns its widget listeners and in-flight operations.
 * Changing network is allowed after destroy; changing module/WC identity uses an
 * explicit page reload after the application's full working-file/journal save.
 */
export function createWalletRuntime({config,journal,fetchImpl=globalThis.fetch}){
 const selected=copy(config);const n=selected.network;
 need(n?.kind==="stellar"&&Object.values(NETWORKS).includes(n.passphrase),"Select a Stellar public or test network");
 need(typeof n.horizonUrl==="string"&&typeof n.rpcUrl==="string","Select original Horizon and RPC endpoints");
 if(selected.wallet?.networkId)need(selected.wallet.networkId===n.id,"Selected wallet belongs to another network configuration");
 need(!activeRuntime,"Close the existing wallet runtime before selecting another configuration");
 const settings=copy(selected.providers?.walletsKit?.publicConfig??{}),ids=settings.moduleIds??Object.keys(constructors);
 need(Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>Object.hasOwn(constructors,id)),"Select supported distinct original wallet modules");
 const moduleSelection=JSON.stringify({ids,walletConnect:settings.walletConnect??null});
 if(initialized===null){
  const modules=ids.map(id=>new constructors[id]());
  if(settings.walletConnect){
   const wc=settings.walletConnect;text(wc.projectId,"Original WalletConnect project ID",256);need(wc.metadata&&typeof wc.metadata.name==="string"&&typeof wc.metadata.description==="string"&&typeof wc.metadata.url==="string"&&Array.isArray(wc.metadata.icons),"Select complete original WalletConnect application metadata");
   const url=new URL(wc.metadata.url);need(url.protocol==="https:"&&!url.username&&!url.password,"Use the registered HTTPS wallet application URL");
   modules.push(new WalletConnectModule({projectId:wc.projectId,metadata:copy(wc.metadata),allowedChains:["stellar:pubnet","stellar:testnet"]}));
  }
  StellarWalletsKit.init({modules,network:n.passphrase,authModal:{showInstallLabel:true,hideUnsupportedWallets:false}});
  initialized=moduleSelection;
 }else{
  need(initialized===moduleSelection,"Save the working file and reload to adopt a different wallet module or WalletConnect application configuration");
  StellarWalletsKit.setNetwork(n.passphrase);
 }
 const wallet=createWalletsKitDriver({kit:StellarWalletsKit,stellar,networkPassphrase:n.passphrase});
 const submission=createStellarSubmissionDriver({stellar,wallet,networkPassphrase:n.passphrase,horizonUrl:n.horizonUrl,rpcUrl:n.rpcUrl,journal,fetchImpl});
 const running=new Set(),widgets=new Set();let closing=false,closed=false,destroyPromise=null;
 function own(fn){need(!closing&&!closed,"Wallet runtime is closing");const p=Promise.resolve().then(fn);running.add(p);p.then(()=>running.delete(p),()=>running.delete(p));return p;}
 const runtime={
  schema:"bim.wallet-runtime.v1",configuration:copy(selected),
  connect:options=>{const i=options===undefined?undefined:copy(options);return own(()=>wallet.connect(i));},getAccount:()=>own(()=>wallet.getAccount()),
  signAndSubmit:input=>{const i=copy(input);return own(()=>submission.signAndSubmit(i));},
  observe:id=>own(()=>submission.observe(id)),readBalance:input=>{const i=copy(input);return own(()=>submission.readBalance(i));},
  prepareMoneyGramPayment:input=>{const i=copy(input);return own(()=>submission.prepareMoneyGramPayment(i));},
  mountMoneyGram:options=>{
   need(!closing&&!closed,"Wallet runtime is closing");
   const p=options?.capability?.session?.public;
   need(p&&NETWORKS[environment(p.environment).network]===n.passphrase,"MoneyGram session network differs from current wallet configuration");
   const widgetSubmission=createStellarSubmissionDriver({stellar,wallet,networkPassphrase:n.passphrase,horizonUrl:n.horizonUrl,rpcUrl:n.rpcUrl,journal,fetchImpl});
   const controller=mountMoneyGramWidget({...options,submission:{
    readBalance:input=>{const i=copy(input);return own(()=>widgetSubmission.readBalance(i));},
    prepareMoneyGramPayment:input=>{const i=copy(input);return own(()=>widgetSubmission.prepareMoneyGramPayment(i));},
    signAndSubmit:input=>{const i=copy(input);return own(()=>widgetSubmission.signAndSubmit(i));},
    observe:id=>own(()=>widgetSubmission.observe(id)),
    close:()=>widgetSubmission.close()
   }});
   widgets.add(controller);return controller;
  },
  destroy(){
   if(destroyPromise)return destroyPromise;if(closed)return Promise.resolve();
   closing=true;
   destroyPromise=(async()=>{try{await Promise.all([submission.close(),...[...widgets].map(w=>w.destroy())]);while(running.size)await Promise.allSettled([...running]);closed=true;widgets.clear();if(activeRuntime===runtime)activeRuntime=null;}catch(error){closing=false;destroyPromise=null;throw error;}})();
   return destroyPromise;
  }
 };
 runtime.wallet={id:wallet.id,source:copy(wallet.source),connect:runtime.connect,getAccount:runtime.getAccount,signEnvelope:input=>{const i=copy(input);return own(()=>wallet.signEnvelope(i));}};
 runtime.submission={readBalance:runtime.readBalance,prepareMoneyGramPayment:runtime.prepareMoneyGramPayment,signAndSubmit:runtime.signAndSubmit,observe:runtime.observe};
 activeRuntime=runtime;return runtime;
}
export const mountWallets=createWalletRuntime;
