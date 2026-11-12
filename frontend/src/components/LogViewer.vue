<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center justify-between gap-2 mb-2 shrink-0">
      <div class="flex items-center gap-2">
        <el-checkbox
          v-model="localAutoScroll"
          :label="$t('serverDetail.logs.autoScroll')"
          class="text-gray-600 dark:text-gray-400"
          @update:model-value="handleAutoScrollChange"
        />
        <el-button size="small" :icon="Delete" plain @click="handleClear">{{
          $t('serverDetail.logs.clear')
        }}</el-button>
        <el-button size="small" :icon="CopyDocument" plain @click="handleCopy">{{
          $t('common.copy')
        }}</el-button>
      </div>
    </div>
    <div
      class="bg-gray-900 dark:bg-black p-4 rounded-lg font-mono text-sm flex-1 min-h-0 overflow-y-auto overflow-x-hidden text-gray-300"
      ref="logsContainer"
    >
      <!-- 保留后端原始文本的换行、缩进与连续空格，长行自动折行避免横向滚动 -->
      <div v-for="(log, index) in logs" :key="index" class="mb-1 whitespace-pre-wrap break-words">
        <span :class="getLogLevelColor(log.level)">{{ formatLogLine(log) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { Delete, CopyDocument } from '@element-plus/icons-vue';
import { useI18n } from 'vue-i18n';
import type { CheckboxValueType } from 'element-plus';
import { formatTimestamp } from '@/utils/format-utils';

interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
}

interface Props {
  logs: LogEntry[];
  autoScroll?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  autoScroll: true
});

const emit = defineEmits<{
  (e: 'update:autoScroll', value: boolean): void;
  (e: 'clear'): void;
  (e: 'copy'): void;
}>();

useI18n();
const logsContainer = ref<HTMLElement | null>(null);
const localAutoScroll = ref(props.autoScroll);

watch(
  () => props.autoScroll,
  (newVal) => {
    localAutoScroll.value = newVal;
  }
);

watch(
  () => props.logs.length,
  () => {
    if (localAutoScroll.value) {
      nextTick(() => {
        if (logsContainer.value) {
          logsContainer.value.scrollTop = logsContainer.value.scrollHeight;
        }
      });
    }
  }
);

function handleAutoScrollChange(val: CheckboxValueType) {
  const value = Boolean(val);
  localAutoScroll.value = value;
  emit('update:autoScroll', value);
}

function handleClear() {
  emit('clear');
}

function handleCopy() {
  emit('copy');
}

function getLogLevelColor(level: string) {
  switch (level) {
    case 'debug':
      return 'text-gray-400';
    case 'info':
      return 'text-blue-400';
    case 'warn':
      return 'text-yellow-400';
    case 'error':
      return 'text-red-400';
    default:
      return 'text-gray-300';
  }
}

/**
 * 拼出单条日志文本。使用模板字符串而非模板内换行，
 * 避免模板缩进被折叠进日志内容，同时保持时间戳与级别格式不变。
 */
function formatLogLine(log: LogEntry): string {
  return `${formatTimestamp(log.timestamp)} [${log.level.toUpperCase()}] ${log.message}`;
}
</script>
