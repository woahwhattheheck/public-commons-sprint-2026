// MIT. Embed the original connection owner in an existing operator host.
// No callback listener, provider, private grant store or SDK runtime is replaced.
import { createHash, randomUUID } from 'node:crypto';
import {
  initializeOAuthConnection,
  type OAuthEnvironment, type OAuthAuthorizationStart, type OAuthFlow,
  type OAuthGrantReview, type OAuthCommandReceipt, type OAuthApproveRequest,
  type OAuthRefreshRequest, type OAuthDisconnectRequest, type OAuthRevokeRequest,
} from '@tokenjunkielabs/starforge-merchant/seller/oauth-connections';
import {
  normalizeOAuthProfile, oauthProfileIdentity, compileOAuthConnection,
  type OAuthProfile, type CompiledOAuthConnection,
} from '@tokenjunkielabs/starforge-merchant/seller/oauth-connections/profile';
import {
  readOAuthHostConnections, openOAuthConnectionRegistry,
  type OAuthConnectionRegistry, type OAuthRegistrySnapshot,
} from '@tokenjunkielabs/starforge-merchant/seller/oauth-connections/host';

export type RetainedCommand =
  | { alias: string; action: 'approve'; args: OAuthApproveRequest }
  | { alias: string; action: 'refresh'; args: OAuthRefreshRequest }
  | { alias: string; action: 'disconnect'; args: OAuthDisconnectRequest }
  | { alias: string; action: 'revoke'; args: OAuthRevokeRequest };

/**
 * Bind these two methods to the host's existing durable command journal.
 * retain must reject changed input under an existing request ID. Persist the
 * exact command before returning; complete stores the exact original receipt.
 */
export interface HostCommandJournal {
  retain(command: RetainedCommand): Promise<void>;
  complete(command: RetainedCommand, receipt: OAuthCommandReceipt): Promise<void>;
}

export type CommandResult =
  | { kind: 'receipt'; command: RetainedCommand; receipt: OAuthCommandReceipt }
  | { kind: 'command_error'; command: RetainedCommand; error: unknown }
  | { kind: 'receipt_not_recorded'; command: RetainedCommand; receipt: OAuthCommandReceipt; error: unknown };

/**
 * An unchanged command can be submitted here again after an uncertain result.
 * No revision, grant, request ID or reviewer is silently replaced during retry.
 * Errors stay local; do not serialize arbitrary Error objects to an operator UI.
 */
export async function executeRetainedCommand(
  registry: OAuthConnectionRegistry, journal: HostCommandJournal, command: RetainedCommand,
): Promise<CommandResult> {
  const retained = structuredClone(command);
  await journal.retain(structuredClone(retained)); // Failure here dispatches nothing.
  let receipt: OAuthCommandReceipt;
  try {
    switch (retained.action) {
      case 'approve': receipt = await registry.approve(retained.alias, retained.args); break;
      case 'refresh': receipt = await registry.refresh(retained.alias, retained.args); break;
      case 'disconnect': receipt = await registry.disconnect(retained.alias, retained.args); break;
      case 'revoke': receipt = await registry.revoke(retained.alias, retained.args); break;
      default: throw new Error('The retained command has an unsupported action.');
    }
  } catch (error: unknown) {
    return { kind: 'command_error', command: retained, error };
  }
  try { await journal.complete(structuredClone(retained), structuredClone(receipt)); }
  catch (error: unknown) { return { kind: 'receipt_not_recorded', command: retained, receipt, error }; }
  return { kind: 'receipt', command: retained, receipt };
}

export interface HostInteraction {
  /**
   * Deliver this URL to the selected operator and return the actual query from
   * the already-running registered loopback callback. Keep this host alive.
   * The core validates state/issuer/duplicates; never rebuild those values.
   */
  authorize(start: OAuthAuthorizationStart): Promise<URLSearchParams>;
  /** Show this exact source/profile and returned scopes/expiry before approval. */
  review(input: { profile: OAuthProfile; connection: OAuthRegistrySnapshot; flow: OAuthFlow }):
    Promise<OAuthGrantReview | null>;
  /**
   * Ask the existing operator UI what to do with the original retained request.
   * retry_same is an explicit decision, not an automatic provider retry loop.
   * keep_pending ends this call with the command/result still available to the host.
   */
  commandProblem(result: Exclude<CommandResult, { kind: 'receipt' }>):
    Promise<'retry_same' | 'keep_pending'>;
}

export interface SourceHostOptions {
  /** All configuration below is supplied by the host, never an untrusted browser body. */
  connectionsFile: string;
  alias: string;
  env: OAuthEnvironment;
  profile: unknown;
  sourceBytes: Uint8Array;
  sourceScheme: string;
  resourceOrigin: string;
  requiredScopes: readonly string[];
  /** Actual registered http://127.0.0.1:PORT origin; the source-specific path is added below. */
  callbackOrigin: string;
  allowLoopback?: boolean;
  journal: HostCommandJournal;
  interaction: HostInteraction;
}

export type SourceHostResult<T> =
  | { kind: 'used'; binding: CompiledOAuthConnection; value: T }
  | { kind: 'authorization_not_approved'; flow: OAuthFlow }
  | { kind: 'command_problem'; result: CommandResult };

/**
 * One complete ownership lifetime: provision the exact profile, open the
 * original alias registry, obtain/review authorization if needed, pass a
 * current compiled binding to the application's original compiler, then close.
 *
 * The use callback runs while the registry is open. It may use the original
 * registry methods and executeRetainedCommand for explicit maintenance.
 */
export async function withReviewedSourceConnection<T>(
  options: SourceHostOptions,
  use: (context: {
    registry: OAuthConnectionRegistry;
    alias: string;
    binding: CompiledOAuthConnection;
    sourceSha256: string;
    run: (command: RetainedCommand) => Promise<CommandResult>;
  }) => Promise<T>,
): Promise<SourceHostResult<T>> {
  const allowLoopback = options.allowLoopback ?? false;
  const env = { ...options.env };
  const profile = normalizeOAuthProfile(options.profile, { allowLoopback });
  const sourceSha256 = createHash('sha256').update(options.sourceBytes).digest('hex');
  if (profile.source.sha256 !== sourceSha256 || profile.source.scheme !== options.sourceScheme)
    throw new Error('The host profile must name the exact selected source bytes and security scheme.');

  const connections = await readOAuthHostConnections(options.connectionsFile);
  const selected = connections.find(entry => entry.alias === options.alias);
  if (!selected) throw new Error('The selected alias is absent from the trusted host configuration.');
  const directory = env[selected.directoryEnv];
  if (typeof directory !== 'string' || !directory)
    throw new Error('The selected host directory environment reference is not provisioned.');

  // The core initializes this selected store or verifies its identical existing profile.
  // Any other trusted aliases in the host file must already have their own provisioned stores.
  // A changed source/profile requires its own explicit host alias and private store.
  await initializeOAuthConnection(directory, { profile, allowLoopback });
  const registry = await openOAuthConnectionRegistry({ connections, env, allowLoopback });
  let primaryFailure = false, primaryError: unknown;
  try {
    let current = await registry.status(options.alias);
    if (current.profileSha256 !== oauthProfileIdentity(profile))
      throw new Error('The selected host alias changed its original profile.');

    if (current.grant.state !== 'connected' || !current.grant.review) {
      const callback = new URL(options.callbackOrigin);
      if (callback.origin !== options.callbackOrigin)
        throw new Error('Use the actual callback origin without a path, query or fragment.');
      const started = await registry.begin(options.alias, {
        expectedRevision: current.revision,
        requestId: randomUUID(),
        redirectUri: new URL(current.callbackPath, callback).href,
      });
      const parameters = await options.interaction.authorize(started);
      const flow = await registry.complete(options.alias, { flowId: started.flowId, parameters });
      if (flow.phase !== 'review_grant' || !flow.reviewId)
        return { kind: 'authorization_not_approved', flow };

      current = await registry.status(options.alias, { flowId: flow.flowId });
      const review = await options.interaction.review({ profile: current.profile, connection: current, flow });
      if (review === null) {
        const discarded = await registry.discard(options.alias, { flowId: flow.flowId });
        return { kind: 'authorization_not_approved', flow: discarded };
      }

      // Snapshot this exact command before sending. Retries preserve its complete input.
      const approval: RetainedCommand = {
        alias: options.alias, action: 'approve',
        args: { expectedRevision: current.revision, requestId: randomUUID(),
          flowId: flow.flowId, reviewId: flow.reviewId, review },
      };
      for (;;) {
        const result = await executeRetainedCommand(registry, options.journal, approval);
        if (result.kind === 'receipt') {
          if (result.receipt.operation.state !== 'completed')
            return { kind: 'command_problem', result };
          break;
        }
        if (await options.interaction.commandProblem(result) !== 'retry_same')
          return { kind: 'command_problem', result };
      }
    }

    // This rechecks the CURRENT grant. A saved package may not reuse an older grant ID.
    const binding = compileOAuthConnection(await registry.binding(options.alias, {
      sourceSha256, scheme: options.sourceScheme,
      resourceOrigin: options.resourceOrigin, requiredScopes: options.requiredScopes,
    }), { resourceOrigin: options.resourceOrigin, allowLoopback });
    const value = await use({
      registry, alias: options.alias, binding, sourceSha256,
      run: command => executeRetainedCommand(registry, options.journal, command),
    });
    return { kind: 'used', binding, value };
  } catch (error: unknown) {
    primaryFailure = true; primaryError = error; throw error;
  } finally {
    try { await registry.close(); }
    catch (closeError: unknown) {
      if (primaryFailure)
        throw new AggregateError([primaryError, closeError], 'The host operation and its connection shutdown both failed.');
      throw closeError;
    }
  }
}

