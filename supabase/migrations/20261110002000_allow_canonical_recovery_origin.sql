-- Allow the exact public Devnet origin alongside the existing Vercel hosts.
-- Existing deployments stay disabled until an operator reconciles the hold.
alter table headstails_recovery.control
  drop constraint control_origin_check,
  add constraint control_origin_check check (
    origin = 'https://headstails.fun'
    or origin ~ '^https://headstails-devnet-beta[a-z0-9-]*[.]vercel[.]app$'
  );
