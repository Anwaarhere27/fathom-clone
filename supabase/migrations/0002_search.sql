-- Cross-meeting transcript search.
--
-- Runs as SECURITY INVOKER (the default) so row-level security still applies:
-- a caller only ever matches their own transcripts.

create or replace function search_transcripts(q text, max_results integer default 60)
returns table (
  segment_id    uuid,
  meeting_id    uuid,
  meeting_title text,
  started_at    timestamptz,
  accent        text,
  speaker_name  text,
  start_ms      integer,
  text          text,
  headline      text,
  rank          real
)
language sql
stable
as $$
  with query as (
    -- websearch_to_tsquery understands quoted phrases and "or", which is what
    -- someone typing into a search box actually expects.
    select websearch_to_tsquery('english', q) as tsq
  )
  select
    t.id,
    m.id,
    m.title,
    m.started_at,
    m.accent,
    t.speaker_name,
    t.start_ms,
    t.text,
    ts_headline(
      'english', t.text, query.tsq,
      'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=26, MinWords=8, FragmentDelimiter= … '
    ),
    ts_rank(t.fts, query.tsq)
  from transcript_segments t
  join meetings m on m.id = t.meeting_id
  cross join query
  where query.tsq is not null
    and t.fts @@ query.tsq
  order by ts_rank(t.fts, query.tsq) desc, m.started_at desc
  limit greatest(1, least(max_results, 200));
$$;

grant execute on function search_transcripts(text, integer) to authenticated;
