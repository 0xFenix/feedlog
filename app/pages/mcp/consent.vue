<script setup lang="ts">
import type { McpConsentContext } from '#layers/feedlog/shared/types/mcp'
import { mcpClientDisplay } from '#layers/feedlog/shared/utils/mcp-client'

type ConsentState = {
  step: 'authorize' | 'sign-in' | 'error'
  client?: McpConsentContext['client']
  context?: McpConsentContext
  message?: string
}
type RequestError = { status?: number; statusCode?: number; data?: { message?: string; data?: { code?: string } } }

definePageMeta({ layout: false })
if (import.meta.server) useResponseHeader('Cache-Control').value = 'private, no-store'
const { t } = useI18n()
useHead({ title: 'Authorize FeedLog access', meta: [{ name: 'robots', content: 'noindex' }, { name: 'referrer', content: 'no-referrer' }] })
const route = useRoute()
const oauthQuery = computed(() => (route.fullPath.split('?')[1] ?? '').split('#')[0] ?? '')
const requestFetch = useRequestFetch()
const origin = useRequestURL().origin
const { data: session, refresh: refreshSession } = await useAuthSession()
const { open: openLogin, isOpen: loginOpen } = useLoginModal()
const selected = ref<string[]>([])
const busy = ref(false)
const failure = ref('')
const switched = ref(false)
const originalUserId = ref<string | null>(null)
const placeholderRows = ref(3)
const signedIn = computed(() => !!session.value?.user)

async function loadState(): Promise<ConsentState> {
  const clientId = new URLSearchParams(oauthQuery.value).get('client_id')
  if (!clientId) return { step: 'error', message: t('mcp.startFromClient') }
  try {
    if (signedIn.value) {
      try {
        const context = await requestFetch<McpConsentContext>('/api/mcp/consent-context', { query: { oauth_query: oauthQuery.value } })
        return { step: 'authorize', client: context.client, context }
      } catch (cause) {
        const error = cause as RequestError
        if ((error.statusCode ?? error.status) !== 401 && error.data?.data?.code !== 'LOCAL_AUTH_REQUIRED') throw cause
      }
    }
    // Client branding is displayed only after the provider validates the signed request.
    const client = await requestFetch<{ client_id: string; client_name?: string | null }>('/api/auth/oauth2/public-client-prelogin', {
      method: 'POST',
      headers: { origin },
      body: { client_id: clientId, oauth_query: oauthQuery.value },
    })
    return { step: 'sign-in', client: mcpClientDisplay(client.client_id, client.client_name ?? null) }
  } catch (cause) {
    const error = cause as RequestError
    return { step: 'error', message: error.data?.message || t('mcp.authorizationUnavailable') }
  }
}

// Resolve the first screen during SSR so a valid session never paints the sign-in or error state.
const { data: state, status, refresh } = await useAsyncData('mcp-consent-page', loadState, {
  watch: [oauthQuery, () => session.value?.session.id],
})
const loading = computed(() => status.value === 'pending' || status.value === 'idle')
const context = computed(() => state.value?.context)
const client = computed(() => state.value?.client)

watch(context, value => {
  failure.value = ''
  if (!value) { selected.value = []; return }
  const changedAccount = originalUserId.value !== null && originalUserId.value !== value.user.id
  selected.value = switched.value || changedAccount ? [] : [...value.selectedOrganizationIds]
  originalUserId.value = value.user.id
  placeholderRows.value = value.organizations.length
  switched.value = false
}, { immediate: true })

watch(() => session.value?.session.id, () => {
  selected.value = []
  if (signedIn.value) loginOpen.value = false
})

async function switchAccount() {
  busy.value = true
  try {
    const result = await useAuth().signOut()
    if (result.error) throw result.error
    switched.value = true
    selected.value = []
    await refreshSession()
    openLogin()
  } catch { failure.value = t('mcp.operationFailed') }
  finally { busy.value = false }
}

async function respond(accept: boolean) {
  if (!context.value || busy.value || loading.value) return
  busy.value = true; failure.value = ''
  try {
    const result = await useApiFetch<{ redirectUrl: string }>('/api/mcp/consent', {
      method: 'POST',
      body: { authorizationRequestId: context.value.authorizationRequestId, expectedUserId: context.value.user.id, accept, organizationIds: selected.value },
    })
    window.location.assign(result.redirectUrl)
  } catch (cause) {
    const error = cause as RequestError
    const code = error.data?.data?.code
    if (code === 'ACCOUNT_CHANGED' || code === 'AUTHORIZATION_CHANGED') {
      switched.value = true
      await refreshSession()
      await refresh()
      selected.value = []
    }
    failure.value = error.data?.message || t('mcp.operationFailed')
  } finally { busy.value = false }
}
</script>

<template>
  <main class="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-6">
      <section aria-labelledby="consent-title" :aria-busy="loading" class="mx-auto flex min-h-full w-full max-w-md flex-col justify-center">
        <div class="space-y-6 py-2">
          <header class="text-center">
            <div class="mb-4 flex items-center justify-center gap-4">
              <span class="flex size-14 items-center justify-center rounded-lg border border-border bg-card" :aria-label="client?.name">
                <span v-if="loading && !client" class="size-7 animate-pulse rounded-md bg-muted" />
                <McpLogo v-else :type="client?.type || 'other'" :size="28" />
              </span>
              <Icon name="lucide:x" size="16" class="text-muted-foreground" />
              <span class="flex size-14 items-center justify-center rounded-lg border border-border bg-card"><AppLogo :size="32" /></span>
            </div>
            <h1 id="consent-title" tabindex="-1" class="font-heading text-2xl font-bold outline-none">{{ client ? t('mcp.authorizeApplication', { application: client.name }) : t('mcp.authorizeFeedLog') }}</h1>
            <p v-if="client" class="mt-2 text-sm leading-relaxed text-muted-foreground">{{ t('mcp.wantsAccess', { application: client.name }) }}</p>
          </header>

          <template v-if="loading">
            <p role="status" class="sr-only">{{ t('a11y.loading') }}</p>
            <div aria-hidden="true" class="space-y-6 animate-pulse">
              <div class="space-y-3">
                <div class="h-5 w-28 rounded bg-border/50" />
                <div class="flex h-4 items-center justify-between"><div class="h-3 w-24 rounded bg-border/50" /><div class="h-3 w-20 rounded bg-border/50" /></div>
                <div class="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  <div v-for="row in placeholderRows" :key="row" class="flex items-center gap-3 bg-card px-3 py-2.5"><div class="size-4 rounded-sm bg-border/50" /><div class="size-7 rounded-md bg-border/50" /><div class="h-4 w-28 rounded bg-border/50" /></div>
                </div>
              </div>
              <div class="space-y-2"><div class="h-3 rounded bg-border/50" /><div class="h-3 w-4/5 rounded bg-border/50" /></div>
              <div class="space-y-3"><div class="grid grid-cols-2 gap-3"><div class="h-10 rounded-md bg-border/50" /><div class="h-10 rounded-md bg-border/50" /></div><div class="mx-auto h-4 w-56 rounded bg-border/50" /></div>
            </div>
          </template>

          <template v-else-if="context">
            <fieldset class="min-w-0" :disabled="busy">
              <legend class="mb-3 text-sm font-semibold">{{ t('mcp.organizations') }}</legend>
              <McpOrganizations v-model="selected" :organizations="context.organizations" :disabled="busy" :scrollable="false" />
            </fieldset>
            <p class="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><Icon name="lucide:shield-check" size="16" class="mt-0.5 shrink-0" /><span>{{ t('mcp.authorizationNote') }}</span></p>
            <p v-if="failure" role="alert" class="text-sm text-destructive">{{ failure }}</p>
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-3"><Button class="h-10" :disabled="busy || !selected.length" @click="respond(true)">{{ t('mcp.authorize') }}</Button><Button class="h-10" variant="outline" :disabled="busy" @click="respond(false)">{{ t('mcp.deny') }}</Button></div>
              <div class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs">
                <p class="text-muted-foreground">{{ t('mcp.signedInAs') }} <span class="font-medium text-foreground">{{ context.user.email }}</span></p>
                <button type="button" class="rounded-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" :disabled="busy" @click="switchAccount">{{ t('mcp.switchAccount') }}</button>
              </div>
            </div>
          </template>

          <div v-else-if="state?.step === 'sign-in'" class="space-y-4 text-center">
            <p class="text-sm text-muted-foreground">{{ t('mcp.signInToContinue') }}</p>
            <Button class="h-10 w-full" @click="openLogin()">{{ t('common.signIn') }}</Button>
          </div>

          <div v-else-if="state?.step === 'error'" class="space-y-4 text-center">
            <p role="alert" class="text-sm text-destructive">{{ failure || state.message }}</p>
            <div class="flex justify-center gap-3">
              <Button v-if="signedIn" class="h-10" variant="outline" :disabled="busy" @click="switchAccount">{{ t('mcp.switchAccount') }}</Button>
              <Button class="h-10" variant="ghost" @click="refresh()">{{ t('mcp.retry') }}</Button>
            </div>
          </div>
        </div>
      </section>
    </div>
    <LoginModal v-model:open="loginOpen" />
  </main>
</template>
