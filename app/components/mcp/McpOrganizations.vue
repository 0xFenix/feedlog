<script setup lang="ts">
withDefaults(defineProps<{ organizations: { id: string; name: string; role: string }[]; disabled?: boolean; scrollable?: boolean }>(), { scrollable: true })
const selected = defineModel<string[]>({ required: true })
function toggle(id: string, checked: boolean) {
  selected.value = checked ? [...new Set([...selected.value, id])] : selected.value.filter(item => item !== id)
}
</script>

<template>
  <fieldset :disabled="disabled" class="min-w-0 space-y-3">
    <div class="flex items-center justify-between gap-3 text-xs">
      <span class="text-muted-foreground">{{ $t('mcp.selectedCount', { selected: selected.length, total: organizations.length }) }}</span>
      <div class="flex items-center gap-3">
        <button type="button" class="font-semibold text-primary hover:underline" @click="selected = organizations.map(org => org.id)">{{ $t('mcp.selectAll') }}</button>
        <button type="button" class="font-semibold text-muted-foreground hover:underline" @click="selected = []">{{ $t('mcp.clear') }}</button>
      </div>
    </div>
    <div class="divide-y divide-border overflow-hidden rounded-lg border border-border" :class="{ 'max-h-72 overflow-y-auto': scrollable }">
      <label v-for="org in organizations" :key="org.id" class="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/60" :class="selected.includes(org.id) ? 'bg-secondary/40' : 'bg-card'">
        <input :checked="selected.includes(org.id)" type="checkbox" class="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" @change="toggle(org.id, ($event.target as HTMLInputElement).checked)">
        <span aria-hidden="true" class="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-xs font-bold">{{ org.name.slice(0, 2).toUpperCase() }}</span>
        <span class="flex min-w-0 flex-1 items-center justify-between gap-2"><span class="truncate text-sm font-semibold">{{ org.name }}</span><span class="shrink-0 text-xs text-muted-foreground">{{ $t('mcp.roles.' + org.role) }}</span></span>
      </label>
      <p v-if="!organizations.length" class="px-4 py-8 text-center text-sm text-muted-foreground">{{ $t('mcp.noOrganizations') }}</p>
    </div>
  </fieldset>
</template>
