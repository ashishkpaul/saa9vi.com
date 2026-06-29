import { Job } from 'bullmq';
import { InstructorIndexerService } from '../services/instructor-indexer.service';

export interface InstructorIndexerJobData {
  instructorProfileId: string;
  channelId: string;
  action: 'index' | 'delete';
}

export const instructorIndexerJobId = 'instructor-indexer';

export async function processInstructorIndexerJob(
  job: Job<InstructorIndexerJobData>,
  indexerService: InstructorIndexerService,
): Promise<void> {
  const { action, instructorProfileId } = job.data;

  if (action === 'delete') {
    await indexerService.deleteProfile(instructorProfileId);
  } else {
    // For index action, the profile should be passed or fetched
    // This job is triggered after create/update with the profile data
    job.log(`Indexing instructor profile ${instructorProfileId}`);
  }
}
