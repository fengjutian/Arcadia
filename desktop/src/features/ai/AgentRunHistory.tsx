import { t } from '../../i18n'
import { Empty, List, Tag, Typography } from '../../components/ui'
import type { AgentRun } from '../../api'

const STATUS_COLOR: Record<string, string> = {
  pending: 'default',
  running: 'blue',
  awaiting_approval: 'gold',
  completed: 'green',
  failed: 'red',
  cancelled: 'orange',
}

interface ParsedStep {
  index: number
  kind: string
  summary: string
  at: string
}

/** Parse the stored `steps_json` column, tolerating malformed history rows. */
export function parseAgentSteps(stepsJson: string): ParsedStep[] {
  try {
    const value: unknown = JSON.parse(stepsJson || '[]')
    return Array.isArray(value) ?( value as ParsedStep[]) : []
  } catch {
    return []
  }
}

/**
 * Read-only view of the persisted `agent_runs` rows.
 *
 * Each run shows its recorded steps so a user can audit what the agent did
 * rather than only seeing the final answer.
 */
export function AgentRunHistory({ runs }: { runs: readonly AgentRun[] }) {
  if (runs.length === 0) {
    return <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <div>
          <div>{t("\u6682\u65E0\u6DF1\u5EA6\u7814\u7A76\u8BB0\u5F55")}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("\u666E\u901A\u95EE\u7B54\u4FDD\u5B58\u5728\u5DE6\u4FA7\u5F53\u524D\u5BF9\u8BDD\u4E2D\uFF1B\u8FD9\u91CC\u53EA\u8BB0\u5F55\u70B9\u51FB\u201C\u6DF1\u5EA6\u7814\u7A76\u201D\u540E\u6267\u884C\u7684\u4EFB\u52A1\u3002")} 

          </Typography.Text>
        </div>
      }
    />
  }
  return <List
    dataSource={[...runs]}
    renderItem={       (run




























    )               =>(<List.Item>
        <List.Item.Meta title={<Typography.Text strong>{run.title||t("(\u65E0\u6807\u9898)")}</Typography.Text>}description={<div className="agent-run-steps">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {run.startedAt}
              </Typography.Text>
              <div>
                <Tag color={STATUS_COLOR[run.status] ?? 'default'}>{run.status}</Tag>
              </div>
              {parseAgentSteps(run.stepsJson).map(        (step)=>(<Typography.Text key={`${run.id}-${step.index}`}style={{fontSize:12}}>
                  {step.index}. [{step.kind}] {step.summary}
                </Typography.Text>))}
              {run.lastError &&(<Typography.Text type="danger"style={{fontSize:12}}>{run.lastError}</Typography.Text>)}
              {run.finalAnswer &&(<Typography.Paragraph style={{whiteSpace:'pre-wrap',marginBottom:0,fontSize:12}}>
                  {run.finalAnswer}
                </Typography.Paragraph>)}
            </div>}/>
      </List.Item>)}/>}