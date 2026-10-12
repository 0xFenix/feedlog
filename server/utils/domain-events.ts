import type { H3Event } from 'h3'
import type { NitroApp } from 'nitropack/types'
import { getRequestURL } from 'h3'
import { uuidv7 } from 'uuidv7'

// Domain events — how business code announces a fact that has already been
// committed (a feedback post exists, a widget message was accepted) to
// in-process subscribers: notifications, derived data such as embeddings,
// integrations, and listeners a self-hosted deployment registers from its own
// Nitro plugin without forking core code.
//
// Delivery is best-effort: listeners run outside the response lifecycle, a
// listener failure never affects the business response, and an event can be
// lost on process death. Anything that must not be lost needs a persistent
// queue, not a listener here.
//
// Business code must publish through this facade only — never call
// nitroApp.hooks.callHook or invent hook names. The facade is what keeps hook
// naming, failure isolation, and scheduling in one place.

// The catalog: every publishable fact and its fields. `data` stays minimal —
// subscribers load anything else by id. The three widget message events and a
// widget-born feedback.created share a `messageId` (the triggering user
// message, written in the flow's first transaction) so subscribers can join
// the events of one message flow.
export interface FeedLogDomainEventMap {
  'inbox.handoff': { conversationId: string; reason: import('../../shared/inbox/state').HandoffReason }
  'inbox.staff-replied': { conversationId: string; itemId: string }
  'inbox.closed': { conversationId: string; fromStatus: import('../../shared/inbox/state').InboxStatus }

  'widget.message-received': {
    conversationId: string
    messageId: string
    isNewConversation: boolean
    attachmentCount: number
  }
  'widget.message-resolved': {
    conversationId: string
    messageId: string
    outcome: 'feedback' | 'support' | 'clarify' | 'unrecognized'
    resolutionSource: 'model' | 'policy-fallback'
  }
  'widget.message-processing-failed': {
    conversationId: string
    messageId: string
    reason: 'provider-error' | 'invalid-output'
  }
  'feedback.created': {
    feedbackId: string
    boardId: string | null
    // Which entry point filed the feedback — a domain fact in its own right
    // (the post row does not record it). messageId is null for portal.
    source: 'portal' | 'widget' | 'mcp'
    messageId: string | null
  }
}

export type DomainEventName = keyof FeedLogDomainEventMap

// Interfaces have no runtime form, so the catalog names are repeated here for
// onAnyDomainEvent to register on; `satisfies` keeps the two in lockstep —
// a map entry missing here would silently escape cross-cutting subscribers.
const DOMAIN_EVENT_NAMES = Object.keys({
  'inbox.handoff': null,
  'inbox.staff-replied': null,
  'inbox.closed': null,
  'widget.message-received': null,
  'widget.message-resolved': null,
  'widget.message-processing-failed': null,
  'feedback.created': null,
} satisfies Record<DomainEventName, null>) as DomainEventName[]

export interface DomainEventEnvelope<Name extends DomainEventName = DomainEventName> {
  // Unique per event, so a subscriber's own logs can be tied back to the
  // publishing flow.
  id: string
  name: Name
  // When the business fact completed — not when a listener ran.
  occurredAt: string
  orgId: string
  // The acting user; null for system-initiated flows. Guests count too — they
  // hold a real server-side user id.
  userId: string | null
  data: FeedLogDomainEventMap[Name]
}

// The union distributed per name, so `switch (domainEvent.name)` narrows `data`.
export type AnyDomainEvent = {
  [Name in DomainEventName]: DomainEventEnvelope<Name>
}[DomainEventName]

// What in-process delivery can offer beyond the envelope. Every field is
// optional and a listener must work without any of them.
export interface DomainEventDeliveryContext {
  // Origin the triggering request arrived on. Carried for subscribers that
  // build absolute links and fall back to the request origin when no canonical
  // base URL is configured (see post-link-builder).
  requestOrigin?: string
  // The tenant slug the request arrived on — a readable handle for the org
  // that orgId alone cannot give a subscriber without a lookup. Deliberately
  // not in the envelope: a slug is a mutable label on the org, not part of
  // the fact, and it comes from the request rather than the business flow.
  orgSlug?: string
  // The request that published the event, so a subscriber can read whatever
  // else it needs — headers, cookies, locale — without this interface growing
  // a field per use. Three constraints ride along:
  //   - Absent whenever nothing published this from a live request, so a
  //     subscriber that leans on it degrades silently rather than failing.
  //   - Read it, never write to it. Listeners run after the response may have
  //     been sent, so touching the response side throws or does nothing.
  //   - Read it synchronously at the top of the handler. Some runtimes tear
  //     the request down once the response completes, which is before a
  //     listener's later awaits resume.
  request?: H3Event
}

export type DomainEventHandler<Name extends DomainEventName = DomainEventName> = (
  domainEvent: DomainEventEnvelope<Name>,
  context?: DomainEventDeliveryContext,
) => void | Promise<void>

// One exact Nitro hook per fact: `feedback.created` → `feedlog:feedback:created`.
// Narrow subscribers register on exactly the fact they care about and the
// callback arrives already typed; there is no single shared hook and no
// wildcard. The event name (not the hook name) is the transport-independent
// contract other delivery paths reuse.
export type DomainEventHookName<Name extends DomainEventName = DomainEventName> =
  Name extends `${infer Domain}.${infer Fact}` ? `feedlog:${Domain}:${Fact}` : never

type FeedLogDomainEventHooks = {
  [Name in DomainEventName as DomainEventHookName<Name>]: DomainEventHandler<Name>
}

declare module 'nitropack/types' {
  // Declaration merging into Nitro's hook table — the "empty" interface is the merge.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface NitroRuntimeHooks extends FeedLogDomainEventHooks {}
}

function toHookName(name: DomainEventName): DomainEventHookName {
  // Event names carry exactly one dot (domain.fact), so replacing the first
  // occurrence is replacing the only one.
  return `feedlog:${name.replace('.', ':')}` as DomainEventHookName
}

export type DomainEventInput<Name extends DomainEventName> = Omit<
  DomainEventEnvelope<Name>,
  'id' | 'occurredAt'
>

// Creation is separate from publication so a caller can persist the event
// (keeping its id) before publishing, and so occurredAt names the moment the
// fact completed rather than the moment listeners run. Call it right after the
// transaction that established the fact commits — never inside it, or a
// rollback would leave listeners told of a fact that does not exist.
export function createDomainEvent<Name extends DomainEventName>(
  input: DomainEventInput<Name>,
): DomainEventEnvelope<Name> {
  return {
    ...input,
    id: uuidv7(),
    occurredAt: new Date().toISOString(),
  }
}

// Schedules listeners via event.waitUntil so they run outside the response
// lifecycle: the response never waits for a subscriber, and the runtime still
// keeps the process alive until listeners finish where the platform supports it.
export function publishDomainEvent<Name extends DomainEventName>(
  event: H3Event,
  domainEvent: DomainEventEnvelope<Name>,
): void {
  const context: DomainEventDeliveryContext = {
    requestOrigin: getRequestURL(event).origin,
    orgSlug: event.context.orgSlug,
    request: event,
  }
  event.waitUntil(dispatchDomainEvent(useNitroApp(), domainEvent, context))
}

// Scheduled tasks have no HTTP request. Their caller awaits delivery before
// the invocation ends; subscribers already accept an absent request context.
export function publishBackgroundDomainEvent<Name extends DomainEventName>(
  domainEvent: DomainEventEnvelope<Name>,
): Promise<void> {
  return dispatchDomainEvent(useNitroApp(), domainEvent, {})
}

// Hookable's callHook runs listeners sequentially and rejects on the first
// error, which would let one subscriber starve or fail the others. Dispatch
// therefore goes through callHookWith with allSettled: every listener runs,
// every failure is contained. Failure logs carry only the event id, name and
// an error summary — never the payload.
async function dispatchDomainEvent(
  nitroApp: NitroApp,
  domainEvent: DomainEventEnvelope,
  context: DomainEventDeliveryContext,
): Promise<void> {
  // The typed hook table pairs each hook with its exact envelope, which is
  // right for subscribers but cannot express "this union-typed event goes to
  // the hook derived from its own name". Erase the typing here; the pairing
  // holds by construction.
  const hooks = nitroApp.hooks as unknown as {
    callHookWith: (
      caller: (handlers: DomainEventHandler[]) => Promise<void>,
      name: string,
      ...args: unknown[]
    ) => Promise<void>
  }
  await hooks.callHookWith(
    async (handlers) => {
      // The async wrapper turns a listener's synchronous throw into a
      // rejection; bare handler(...) would escape allSettled mid-map.
      const outcomes = await Promise.allSettled(handlers.map(async handler => handler(domainEvent, context)))
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          console.error(
            `[domain-events] listener failed event=${domainEvent.id} name=${domainEvent.name}: ${errorSummary(outcome.reason)}`,
          )
        }
      }
    },
    toHookName(domainEvent.name),
    domainEvent,
    context,
  )
}

function errorSummary(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

// Both helpers register through nitroApp.hooks, so a listener added directly
// via nitroApp.hooks.hook('feedlog:...') and one added here share the same
// table and interoperate.
export function onDomainEvent<Name extends DomainEventName>(
  nitroApp: NitroApp,
  name: Name,
  handler: DomainEventHandler<Name>,
): void {
  // The generic name defeats Hookable's per-key callback inference; the
  // handler's own signature already enforces the pairing.
  nitroApp.hooks.hook(toHookName(name), handler as DomainEventHandler as never)
}

// Cross-cutting subscription: registers the handler on every catalog entry,
// because Hookable has no wildcard and faking one would bypass typed hooks.
export function onAnyDomainEvent(
  nitroApp: NitroApp,
  handler: (domainEvent: AnyDomainEvent, context?: DomainEventDeliveryContext) => void | Promise<void>,
): void {
  for (const name of DOMAIN_EVENT_NAMES) {
    nitroApp.hooks.hook(toHookName(name), handler as never)
  }
}
