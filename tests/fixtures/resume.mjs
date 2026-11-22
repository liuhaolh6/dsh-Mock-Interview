/**
 * Shared test data. Kept as a module (not .json/.md) so the fixtures travel
 * with the test run and need no path juggling on Windows.
 */

export const RESUME_JAVA = `刘浩 — Java 后端工程师
3 年经验，主要技术栈 Java 17 / Spring Boot / MySQL / Redis。
项目：订单中心（后端，负责下单与库存扣减，峰值 QPS 3k）。`

export const JD_JAVA_BACKEND = `岗位：Java 后端开发（中级）
职责：负责交易链路服务开发，要求熟悉 JVM 调优与分布式事务。`

export const PROFILE_CONFIRMED = {
  skills: ['Java', 'Spring Boot', 'MySQL', 'Redis', 'JVM', '分布式事务'],
  years: 3,
  level: 'mid',
  projects: [
    { name: '订单中心', role: '后端', highlights: ['QPS 3k', '库存扣减'] },
    { name: '对账平台', role: '后端', highlights: ['每日千万级流水'] },
  ],
  jd: { title: 'Java 后端', company: '某厂', level: 'mid' },
  edited: true,
}

export const PROFILE_EMPTY = {
  skills: [],
  years: 0,
  level: 'mid',
  projects: [],
  jd: { title: 'Java 后端' },
  edited: true,
}