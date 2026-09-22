-- Share tokens must be URL-safe.
--
-- The original default was encode(gen_random_bytes(9), 'base64'), and standard
-- base64 emits '/' and '+'. A token containing a slash silently breaks the
-- /share/<token> route: the path no longer matches, and the link 404s. Switch
-- to the base64url alphabet and repair any token already issued.

create or replace function url_safe_token()
returns text
language sql
volatile
as $$
  select translate(encode(gen_random_bytes(9), 'base64'), '+/', '-_');
$$;

alter table shares alter column token set default url_safe_token();

update shares
set token = translate(token, '+/', '-_')
where token like '%/%' or token like '%+%';
