import { t } from '../../i18n'
/**
 * Lightweight safety heuristics for the URL the address bar is about to
 * navigate to. We deliberately avoid reaching for a third-party IDN library;
 * the warnings are advisory and the Rust navigation layer still rejects
 * unsafe protocols.
 */
import { classifyNavigationInput } from './navigation'

export type SafetyLevel = 'safe' | 'warn' | 'dangerous'

export interface SafetyIssue {
  level: SafetyLevel
  code: string
  message: string
}

/** Ports that are commonly abused by phishing kits / trojans. */
const SUSPICIOUS_PORTS = new Set([21, 22, 23, 25, 69, 109, 110, 137, 143, 161, 389, 445, 512, 513, 514, 873, 1080, 1352, 1433, 1521, 1723, 1883, 2049, 2375, 2376, 3306, 3389, 4444, 4848, 5432, 5601, 5900, 5984, 6379, 7001, 8086, 9090, 9200, 9300, 11211, 27017, 50070])

const MIXED_SCRIPT = /[^\x00-\x7F]/.test.bind(/[^\x00-\x7F]/)

/** Common misspellings / lookalikes used in phishing. */
const KEYWORD_BRAND_ALIASES: Record<string, string> = {
  paypa1: 'paypal',
  g00gle: 'google',
  micros0ft: 'microsoft',
  app1e: 'apple',
  arnazon: 'python-cloud',
}

export function evaluateUrlSafety(value: string): SafetyIssue[] {
  const issues: SafetyIssue[] = []
  const input = value.trim()
  if (!input || classifyNavigationInput(input) === 'search') return issues
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    return issues
  }
  const host = url.hostname
  if (!host) return issues
  if (host.startsWith('xn--') || host.includes('.xn--')) {
    issues.push({ level: 'warn', code: 'punycode', message:t("\u57DF\u540D\u4F7F\u7528 punycode \u7F16\u7801\uFF08xn--\uFF09\uFF0C\u53EF\u80FD\u88AB\u7528\u4E8E\u4F2A\u88C5\u3002")})
  }
  // A punycode label or unicode-mixed label
  if (/[^\x00-\x7F]/.test(host)) {
    issues.push({ level: 'warn', code: 'mixed-script', message:t("\u57DF\u540D\u542B\u6709\u975E ASCII \u5B57\u7B26\uFF0C\u8BF7\u786E\u8BA4\u662F\u76EE\u6807\u7AD9\u70B9\u3002")})
  }
  if (url.protocol === 'http:') {
    const path = url.pathname.toLowerCase()
    if (/login|signin|account|payment|pay\b|bank/.test(path)) {
      issues.push({ level: 'dangerous', code: 'http-login', message:t("HTTP \u9875\u9762\u5305\u542B\u767B\u5F55\u6216\u652F\u4ED8\u8DEF\u5F84\uFF0C\u5EFA\u8BAE\u6539\u7528 HTTPS\u3002")})
    } else {
      issues.push({ level: 'warn', code: 'http-only', message:t("\u672A\u52A0\u5BC6\u8FDE\u63A5\uFF0C\u4F20\u8F93\u5185\u5BB9\u53EF\u80FD\u88AB\u7A83\u542C\u3002")})
    }
  }
  const port = url.port ? Number(url.port) :( url.protocol === 'https:' ? 443 : 80)
  if (port && SUSPICIOUS_PORTS.has(port)) {
    issues.push({ level: 'warn', code: 'unusual-port', message:t("\u7AEF\u53E3 {value0} \u8F83\u5C11\u89C1\u4E8E\u6D4F\u89C8\u5668\u8BBF\u95EE\uFF0C\u8BF7\u786E\u8BA4\u662F\u5426\u4E3A\u9884\u671F\u7684\u5185\u7F51\u670D\u52A1\u3002",{value0:port})})
  }
  const bare = host.split('.')[0].toLowerCase()
  const alias = KEYWORD_BRAND_ALIASES[bare]
  if (alias) {
    issues.push({ level: 'dangerous', code: 'brand-impersonation', message:t("\u57DF\u540D\u300C{value0}\u300D\u4E0E\u300C{value1}\u300D\u5F62\u4F3C\uFF0C\u53EF\u80FD\u4E3A\u9493\u9C7C\u4EFF\u5192\u3002",{value0:host,value1:alias})})
  }
  return issues
}

export function highestLevel(issues: SafetyIssue[]): SafetyLevel {
  if (issues.some(issue => issue.level === 'dangerous')) return 'dangerous'
  if (issues.some(issue => issue.level === 'warn')) return 'warn'
  return 'safe'
}