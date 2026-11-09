import {readFileSync} from 'node:fs';

// Outside public/: recipient addresses never become browser assets.
const directory=JSON.parse(readFileSync(new URL('./authority-directory.json',import.meta.url),'utf8'));
export const authorityDirectory=directory.authorities;
export function publicAuthorities(records=authorityDirectory){
 return {countries:[...new Map(records.map(a=>[a.country,{code:a.country,name:a.countryName}])).values()].sort((a,b)=>a.name.localeCompare(b.name)),
  authorities:records.map(a=>({id:a.id,country:a.country,name:a.name,category:a.category}))};
}
