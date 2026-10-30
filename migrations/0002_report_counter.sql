-- Report numbers (app/api/report-number): one counter row, raised in a single statement, so two reviewers approving at
-- the same time never get the same number. It starts after the reports already issued.
create table "counter" ("name" text not null primary key, "value" integer not null);

insert into "counter" ("name", "value") select 'report', count(*) from "item", json_each("item"."data", '$.certificates') where "item"."kind" = 'record' and "item"."data" is not null;
