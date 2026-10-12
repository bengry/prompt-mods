import type { ModelCompleteResult } from 'claude-code';

type Failure = Exclude<ModelCompleteResult, { isAnswered: true }>;

export const describeFailure = (reply: Failure): string => {
  switch (reply.reason) {
    case 'api-error':
      return reply.status === null ? `no response from the API (${reply.error})` : `the API returned ${reply.status} (${reply.error})`;
    case 'empty-reply':
      return 'the model replied without any text';
    case 'aborted':
      return 'the request was cancelled';
  }
};
