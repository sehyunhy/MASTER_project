create table if not exists product_catalog (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  product_name text not null,
  category text not null,
  price integer not null check (price >= 0),
  description text not null,
  image_url text,
  source text not null default 'synthetic_qa',
  version text not null default 'product-catalog-v1',
  is_mock boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_catalog_category on product_catalog(category);
create index if not exists idx_product_catalog_active_price on product_catalog(is_active, price);

alter table product_catalog enable row level security;
-- No anon policies: catalog access goes through server routes/service-role scripts.
