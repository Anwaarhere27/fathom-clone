import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
import { Avatar, Card } from "@/components/ui";
import { SearchBox } from "@/components/search-box";
import { createClient } from "@/lib/supabase/server";
import { formatRelativeDay, formatTimestamp, speakerColor } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * ts_headline wraps matches in <mark> but does not escape the surrounding
 * transcript text, and transcripts include whatever was in an uploaded
 * recording. Escape everything, then restore only the marks we asked for.
 */
function safeHeadline(headline: string) {
  const escaped = headline
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped.replace(/&lt;mark&gt;/g, "<mark>").replace(/&lt;\/mark&gt;/g, "</mark>");
}

interface Hit {
  segment_id: string;
  meeting_id: string;
  meeting_title: string;
  started_at: string;
  accent: string;
  speaker_name: string;
  start_ms: number;
  text: string;
  headline: string;
  rank: number;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  let hits: Hit[] = [];
  if (query) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("search_transcripts", { q: query, max_results: 60 });
    hits = (data ?? []) as Hit[];
  }

  // Grouped by meeting: five hits in one call is one result worth opening, not
  // five results.
  const grouped = new Map<string, { title: string; startedAt: string; accent: string; hits: Hit[] }>();
  for (const hit of hits) {
    const existing = grouped.get(hit.meeting_id);
    if (existing) existing.hits.push(hit);
    else
      grouped.set(hit.meeting_id, {
        title: hit.meeting_title,
        startedAt: hit.started_at,
        accent: hit.accent,
        hits: [hit],
      });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Search</h1>
      <p className="mt-1 text-[13.5px] text-ink-soft">
        Every word anyone said, across every meeting you own.
      </p>

      <div className="mt-5">
        <SearchBox initialQuery={query} />
      </div>

      {!query ? (
        <div className="mt-10 text-center">
          <SearchIcon size={22} className="mx-auto mb-3 text-ink-faint" />
          <p className="mx-auto max-w-sm text-[13.5px] leading-relaxed text-ink-soft">
            Try a name, a customer, or something you half-remember someone saying. Quoted phrases
            and <span className="font-medium">or</span> both work.
          </p>
        </div>
      ) : hits.length === 0 ? (
        <p className="mt-10 text-center text-[13.5px] text-ink-soft">
          Nothing matches “{query}”.
        </p>
      ) : (
        <>
          <p className="mb-3 mt-6 text-[12.5px] text-ink-faint">
            {hits.length} {hits.length === 1 ? "moment" : "moments"} across {grouped.size}{" "}
            {grouped.size === 1 ? "meeting" : "meetings"}
          </p>

          <div className="space-y-3">
            {[...grouped].map(([meetingId, group]) => (
              <Card key={meetingId} className="overflow-hidden">
                <div className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
                  <span
                    className="h-4 w-1 rounded-full"
                    style={{ background: `var(--color-accent-${group.accent})` }}
                    aria-hidden
                  />
                  <Link
                    href={`/meetings/${meetingId}`}
                    className="text-[14px] font-semibold tracking-tight hover:text-brand-ink"
                  >
                    {group.title}
                  </Link>
                  <span className="ml-auto shrink-0 text-[11.5px] text-ink-faint">
                    {formatRelativeDay(group.startedAt)}
                  </span>
                </div>

                <ul>
                  {group.hits.slice(0, 4).map((hit) => (
                    <li key={hit.segment_id}>
                      {/* Deep link carries the timestamp so the meeting opens at
                          the moment, not at the top. */}
                      <Link
                        href={`/meetings/${meetingId}?t=${hit.start_ms}`}
                        className="flex gap-3 px-4 py-2.5 transition-colors hover:bg-sunken"
                      >
                        <Avatar
                          name={hit.speaker_name}
                          color={speakerColor(hit.speaker_name)}
                          size={24}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex items-baseline gap-2">
                            <span className="text-[12.5px] font-medium">{hit.speaker_name}</span>
                            <span className="tnum text-[11.5px] text-brand-ink">
                              {formatTimestamp(hit.start_ms)}
                            </span>
                          </div>
                          <p
                            className="text-[13px] leading-[1.55] text-ink-soft [&_mark]:rounded [&_mark]:bg-caution/30 [&_mark]:px-0.5 [&_mark]:text-ink"
                            dangerouslySetInnerHTML={{ __html: safeHeadline(hit.headline) }}
                          />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>

                {group.hits.length > 4 && (
                  <Link
                    href={`/meetings/${meetingId}`}
                    className="block border-t border-line px-4 py-2 text-[12.5px] text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
                  >
                    {group.hits.length - 4} more in this meeting
                  </Link>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
