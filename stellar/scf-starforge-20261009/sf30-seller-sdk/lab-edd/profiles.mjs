// MIT. Installed source-format profiles for the same laboratory receiving application.
import { equisProfiles } from './profiles/equis.mjs';
import dts8 from './profiles/dts8.mjs';
export const labProfiles = Object.freeze([...equisProfiles,dts8]);
export function labProfile(id) {
  const profile=labProfiles.find(value=>value.id===id);
  if(!profile)throw Object.assign(new Error('Choose one installed laboratory source profile.'),{code:'JOB_INPUT_LAB_PROFILE'});
  return profile;
}
