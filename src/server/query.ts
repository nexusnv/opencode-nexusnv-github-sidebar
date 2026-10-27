/** One GraphQL round trip powers the whole sidebar. */
export const SIDEBAR_QUERY = `
query Sidebar(
  $owner: String!
  $name: String!
  $branch: String!
  $hasBranch: Boolean!
  $prLimit: Int!
  $issueLimit: Int!
) {
  viewer { login }
  rateLimit { cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    url
    isPrivate
    defaultBranchRef { name }
    pullRequests(
      states: OPEN
      first: $prLimit
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      totalCount
      nodes { ...PullFields }
    }
    branchPr: pullRequests(
      states: OPEN
      first: 1
      headRefName: $branch
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) @include(if: $hasBranch) {
      nodes { ...PullFields }
    }
    issues(
      states: OPEN
      first: $issueLimit
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      totalCount
      nodes { ...IssueFields }
    }
  }
}

fragment PullFields on PullRequest {
  number
  title
  url
  isDraft
  isCrossRepository
  headRefName
  headRefOid
  headRepositoryOwner { login }
  author { login }
  mergeable
  mergeStateStatus
  reviewDecision
  updatedAt
  comments { totalCount }
  reviews { totalCount }
  statusCheckRollup { state }
}

fragment IssueFields on Issue {
  number
  title
  url
  updatedAt
  author { login }
  assignees(first: 5) { nodes { login } }
  comments { totalCount }
  labels(first: 3) {
    totalCount
    nodes { name color }
  }
}
`

export const LAUNCH_PULL_QUERY = `
query LaunchPullContext($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    url
    isPrivate
    defaultBranchRef { name }
    pullRequest(number: $number) {
      number
      title
      url
      body
      state
      isDraft
      isCrossRepository
      headRefName
      headRefOid
      baseRefName
      headRepositoryOwner { login }
      author { login }
      mergeable
      mergeStateStatus
      reviewDecision
      updatedAt
      comments { totalCount }
      reviews { totalCount }
      statusCheckRollup { state }
    }
  }
}
`

export const LAUNCH_ISSUE_QUERY = `
query LaunchIssueContext($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    url
    isPrivate
    defaultBranchRef { name }
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue {
        number
        title
        url
        body
        state
        author { login }
        assignees(first: 10) { nodes { login } }
        labels(first: 10) { nodes { name } }
        comments { totalCount }
        updatedAt
      }
    }
  }
}
`
