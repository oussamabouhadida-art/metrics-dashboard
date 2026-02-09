import { NextRequest, NextResponse } from 'next/server';

async function fetchJiraIssues(jql: string, fields: string[]) {
  const auth = Buffer.from(
    `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
  ).toString('base64');

  const response = await fetch(
    `https://${process.env.JIRA_DOMAIN}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=${fields.join(',')}&maxResults=500&expand=changelog`,
    {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
      cache: 'no-store'
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`JIRA API error: ${response.status} - ${error}`);
  }

  return response.json();
}

function calculateDaysBetween(date1: Date, date2: Date): number {
  const diffTime = Math.abs(date2.getTime() - date1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function findStatusChangeTime(changelog: any, statusName: string): Date | null {
  if (!changelog?.histories) return null;

  for (const history of changelog.histories) {
    for (const item of history.items) {
      if (item.field === 'status' && item.toString === statusName) {
        return new Date(history.created);
      }
    }
  }
  return null;
}

function calculateDORAMetrics(issues: any[]) {
  const releasedIssues = issues.filter(
    i => i.fields.status.name === 'Released' && i.fields.resolutiondate
  );

  // 1. Change Lead Time
  let totalLeadTime = 0;
  let leadTimeCount = 0;

  releasedIssues.forEach(issue => {
    const devStartTime = findStatusChangeTime(issue.changelog, 'In Development');
    const releaseTime = new Date(issue.fields.resolutiondate);

    if (devStartTime) {
      const leadTime = calculateDaysBetween(devStartTime, releaseTime);
      totalLeadTime += leadTime;
      leadTimeCount++;
    }
  });

  const avgLeadTime = leadTimeCount > 0 ? (totalLeadTime / leadTimeCount).toFixed(1) : '0';

  // 2. Deployment Frequency
  const weeksPassed = 4;
  const deploymentFrequency = (releasedIssues.length / weeksPassed).toFixed(1);

  // 3. Change Failure Rate
  const bugs = issues.filter(i => i.fields.issuetype.name === 'Bug');
  const releasedBugs = bugs.filter(b => b.fields.status.name === 'Released');
  const failureRate = releasedIssues.length > 0
    ? ((releasedBugs.length / releasedIssues.length) * 100).toFixed(1)
    : '0';

  // 4. Recovery Time
  let totalRecoveryTime = 0;
  let recoveryCount = 0;

  releasedBugs.forEach(bug => {
    if (bug.fields.created && bug.fields.resolutiondate) {
      const recoveryTime = calculateDaysBetween(
        new Date(bug.fields.created),
        new Date(bug.fields.resolutiondate)
      );
      totalRecoveryTime += recoveryTime * 24;
      recoveryCount++;
    }
  });

  const avgRecoveryTime = recoveryCount > 0
    ? (totalRecoveryTime / recoveryCount).toFixed(1)
    : '0';

  // 5. Velocity
  const storyPoints = issues.reduce((sum, issue) => {
    const points = issue.fields.customfield_10024 || 0;
    return sum + points;
  }, 0);

  return {
    leadTime: parseFloat(avgLeadTime),
    deploymentFrequency: parseFloat(deploymentFrequency),
    changeFailureRate: parseFloat(failureRate),
    recoveryTime: parseFloat(avgRecoveryTime),
    velocity: storyPoints,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project') || 'DAI';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let jql = `project = ${project}`;
    if (startDate) jql += ` AND created >= "${startDate}"`;
    if (endDate) jql += ` AND created <= "${endDate}"`;

    const fields = [
      'status',
      'created',
      'updated',
      'resolutiondate',
      'issuetype',
      'customfield_10024',
    ];

    const data = await fetchJiraIssues(jql, fields);
    const metrics = calculateDORAMetrics(data.issues);

    return NextResponse.json({
      success: true,
      project: project,
      totalIssues: data.total,
      metrics: metrics,
    });

  } catch (error: any) {
    console.error('DORA metrics error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch DORA metrics',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
