-- Include second-owner rows and tombstones in the recovery snapshot.
insert into public.leads(first_name,owner_id) values ('Owner B','22222222-2222-4222-8222-222222222222');
insert into public.tasks(lead_id,title,owner_id)
select lead_id,'Owner B task',owner_id from public.leads where first_name='Owner B';
insert into public.vehicles(make,model,owner_id)
values ('Synthetic','Private B','22222222-2222-4222-8222-222222222222');
insert into public.leads(first_name,owner_id) values ('Deleted fixture','11111111-1111-4111-8111-111111111111');
delete from public.leads where first_name='Deleted fixture';
