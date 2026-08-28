import { FeedClient } from './feed-client';
import { loadFeed } from '../feed/data';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const payload = await loadFeed();
  return <FeedClient payload={payload} />;
}
