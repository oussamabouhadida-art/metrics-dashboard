import { NextResponse } from 'next/server';

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
    throw new Error(`JIRA API error: ${response.status}`);
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

  let totalLeadTime = 0;
  let leadTimeCount = 0;

  releasedIssues.forEach(issue => {
    const devStartTime = findStatusChangeTime(issue.changelog, 'In Development');
    const releaseTime = new Date(issue.fields.resolutiondate);
    if (devStartTime) {
      totalLeadTime += calculateDaysBetween(devStartTime, releaseTime);
      leadTimeCount++;
    }
  });

  const avgLeadTime = leadTimeCount > 0 ? (totalLeadTime / leadTimeCount).toFixed(1) : '0';
  const weeksPassed = 4;
  const deploymentFrequency = (releasedIssues.length / weeksPassed).toFixed(1);

  const bugs = issues.filter(i => i.fields.issuetype.name === 'Bug');
  const releasedBugs = bugs.filter(b => b.fields.status.name === 'Released');
  const failureRate = releasedIssues.length > 0
    ? ((releasedBugs.length / releasedIssues.length) * 100).toFixed(1)
    : '0';

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

  const storyPoints = issues.reduce((sum, issue) => {
    return sum + (issue.fields.customfield_10024 || 0);
  }, 0);

  return {
    leadTime: parseFloat(avgLeadTime),
    deploymentFrequency: parseFloat(deploymentFrequency),
    changeFailureRate: parseFloat(failureRate),
    recoveryTime: parseFloat(avgRecoveryTime),
    velocity: storyPoints,
  };
}

export async function GET() {
  try {
    const projects = ['DAI', 'DGDPO', 'DMM', 'DE', 'VEH', 'CAT'];
    const healthMatrix: Record<string, any> = {};

    const fields = [
      'status',
      'created',
      'resolutiondate',
      'issuetype',
      'customfield_10024',
    ];

    for (const project of projects) {
      const jql = `project = ${project} AND created >= -30d`;
      const data = await fetchJiraIssues(jql, fields);
      const metrics = calculateDORAMetrics(data.issues);
      healthMatrix[project] = metrics;
    }

    return NextResponse.json({
      success: true,
      data: healthMatrix,
    });

  } catch (error: any) {
    console.error('Health matrix error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch health matrix',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
