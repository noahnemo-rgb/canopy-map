-- Canopy: one map per coder, nodes at every level, gaps tracked not filled.
-- Node ids are unique per account, not globally, so two people can both have "my-work".

create table if not exists canopy_plans (
  user_id text primary key,
  plan text not null default 'free',
  pro_interest boolean not null default false,
  seeded boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists canopy_maps (
  user_id text not null,
  id text not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists canopy_nodes (
  user_id text not null,
  id text not null,
  map_id text not null,
  parent_id text,
  name text not null,
  level text not null,
  repo text not null default '',
  maturity text not null default 'idea',
  gaps text not null default '[]',
  scan_flags text not null default '[]',
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists canopy_nodes_user_map_idx on canopy_nodes (user_id, map_id);
