const s = 'postgres://391776e1e8367d5c24567b8be6966b8e8a16cbedeb8c71be313306507a2a2d89:sk_50HAnZoW8sv2PEJ9jRy9s@db.prisma.io:5432/postgres?sslmode=require';
let finalConnectionString = s.replace('postgres://', 'prisma+postgres://');
const u = new URL(finalConnectionString);
if (u.password && !u.searchParams.has('api_key')) {
  u.searchParams.set('api_key', u.password);
  console.log(u.toString());
}
