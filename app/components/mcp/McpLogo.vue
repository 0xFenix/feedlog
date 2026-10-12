<script setup lang="ts">
import { mcpClientLogos } from '~/composables/useMcpClients'
withDefaults(defineProps<{ type: string; size?: number }>(), { size: 24 })
</script>

<template>
  <img v-if="mcpClientLogos[type]" :src="mcpClientLogos[type]" alt="" aria-hidden="true" :width="size" :height="size" :style="{ width: size + 'px', height: size + 'px' }" class="shrink-0 object-contain">
  <Icon v-else name="lucide:puzzle" :size="size" aria-hidden="true" class="shrink-0" />
</template>
