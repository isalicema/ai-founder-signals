import { FeedClient } from './feed-client.js';
import { loadFeed } from '../feed/data.js';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const payload = await loadFeed();
  return <FeedClient payload={payload} />;
}
