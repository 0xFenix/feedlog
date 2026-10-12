<script setup lang="ts">
definePageMeta({ layout: false })
const route = useRoute()
// Preserve the provider's signed query for links opened before the page was unified.
const query = route.fullPath.includes('?') ? route.fullPath.slice(route.fullPath.indexOf('?')) : ''
await navigateTo(`/mcp/consent${query}`, { replace: true, redirectCode: 302 })
</script>

<template>
  <div />
</template>
