/**
 * Human-facing wording for every contract error code (v0.3 C1).
 *
 * The host answers with machine codes; the panel must never show a bare
 * `E_SOMETHING`. Each entry says what happened, what the user can do, and
 * whether retrying is a sensible promise. Kept pure so it is unit-testable
 * without a DOM.
 */

const TABLE = {
  E_BAD_REQUEST: {
    title: '这次提交的内容不完整',
    detail: '缺少必填项，或某个字段超出长度限制。',
    action: '检查表单里被标红的一项，补齐后重新提交。',
    retryable: false,
  },
  E_UNKNOWN_ACTION: {
    title: '插件与宿主版本对不上',
    detail: '宿主转发了一个当前插件不认识的操作。',
    action: '重启宿主后再试；仍然如此说明插件需要升级。',
    retryable: false,
  },
  E_INTERNAL: {
    title: '插件内部出错了',
    detail: '这是一个未预期的错误，通常与某一行数据有关。',
    action: '重试一次；仍然失败请把错误码和当时的操作告诉我。',
    retryable: true,
  },
  E_ASR_NOT_CONFIGURED: {
    title: '语音作答暂时不可用',
    detail: '没有可用的语音转写服务，插件不会假装录音成功。',
    action: '改用文字作答，或在设置里配置自备的 OpenAI 兼容转写端点。',
    retryable: false,
  },
  E_ASR_FAILED: {
    title: '语音没转成文字',
    detail: '自备的转写端点超时、返回非 2xx，或返回体里没有 text。',
    action: '重录一遍；连续失败就检查端点地址与密钥，或改用文字作答。',
    retryable: true,
  },
  E_EXPORT_FAILED: {
    title: '报告没写出去',
    detail: '目标目录不可写、磁盘已满，或同名文件被占用。',
    action: '换一个导出目录，或清理空间后重试。',
    retryable: true,
  },
  E_LLM_TIMEOUT: {
    title: '模型响应超时',
    detail: '这次回答超过 45 秒仍没有结果，模型侧被中断了。',
    action: '重试这一题；如果连续超时，先把答案缩短一点再提交。',
    retryable: true,
  },
  E_LLM_UNAVAILABLE: {
    title: '模型暂时不可用',
    detail: '宿主没有可用模型路由，或上游服务返回了错误。',
    action: '稍等一会儿重试；一直失败请检查宿主的模型配置。',
    retryable: true,
  },
  E_PROFILE_INCOMPLETE: {
    title: '简历信息不够出一道题',
    detail: '画像里的技能和项目都是空的。',
    action: '回到上一步，补上技能或至少一个项目，再开始面试。',
    retryable: false,
  },
  E_PROFILE_INVALID: {
    title: '简历没能解析成结构化信息',
    detail: '模型连续两次都没有返回可用的画像。',
    action: '点「重新解析」再试一次；仍然失败请精简简历后重贴。',
    retryable: true,
  },
  E_SCHEMA_VERSION: {
    title: '这条记录来自更新的版本',
    detail: '文件里的 schemaVersion 比当前插件能读的更高。',
    action: '升级插件后再打开；不要手动改这个文件。',
    retryable: false,
  },
  E_SCORE_INVALID: {
    title: '这题没评出分数',
    detail: '模型两次都没有给出可解析的评分卡。',
    action: '重试这一题；如果反复失败，可以换个更具体的问法继续。',
    retryable: true,
  },
  E_SESSION_FINISHED: {
    title: '这场面试已经结束',
    detail: '结束的面试不再接受新作答，避免分数被反复覆盖。',
    action: '回到报告页复盘，或者新开一场。',
    retryable: false,
  },
  E_SESSION_NOT_FOUND: {
    title: '找不到这场面试',
    detail: '记录可能已被删除，或者会话目录不是当初那一个。',
    action: '回「我的记录」刷新列表；确认记录还在再点进去。',
    retryable: false,
  },
  E_SESSION_TOO_LARGE: {
    title: '这场面试的记录超出容量上限',
    detail: '单个会话文件超过 2 MB，插件拒绝写入以免半途损坏。',
    action: '先导出报告留档，然后新开一场；旧记录可以在这里删掉。',
    retryable: false,
  },
}

const FALLBACK = {
  title: '出了点问题',
  detail: '插件没有为这个错误准备说明。',
  action: '重试一次；仍然失败请把错误码和操作步骤反馈给我。',
  retryable: true,
}

/** Every code this table explains, sorted for stable tests. */
export const ALL_ERROR_CODES = Object.freeze(Object.keys(TABLE).sort())

/**
 * @param {string} code machine code from the host
 * @param {string} [serverMessage] raw message, kept for bug reports
 * @returns {{code: string, title: string, detail: string, action: string, retryable: boolean}}
 */
export function explainError(code, serverMessage = '') {
  const entry = TABLE[code] ?? FALLBACK
  const extra = typeof serverMessage === 'string' ? serverMessage.trim() : ''
  const detail = extra === '' ? entry.detail : `${entry.detail}\n服务器原话：${extra}`
  return {
    code: typeof code === 'string' ? code : String(code ?? ''),
    title: entry.title,
    detail,
    action: entry.action,
    retryable: entry.retryable,
  }
}
