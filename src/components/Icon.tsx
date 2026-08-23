import type { ReactNode } from 'react';

type IconName = 'connect' | 'edit' | 'delete' | 'add' | 'terminal' | 'files' | 'upload' | 'download' | 'refresh' | 'parent' | 'save' | 'close' | 'eye' | 'eyeOff';

type Props = { name: IconName; size?: number };

const paths: Record<IconName, ReactNode> = {
  connect: <><path d="M5 12h11"/><path d="m12 7 5 5-5 5"/></>,
  edit: <><path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="m13 7 4 4"/></>,
  delete: <><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m7 7 1 13h8l1-13"/></>,
  add: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  terminal: <><path d="m5 7 5 5-5 5"/><path d="M12 17h7"/></>,
  files: <><path d="M3 7h7l2 2h9v10H3Z"/><path d="M3 7V5h7l2 2"/></>,
  upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></>,
  download: <><path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></>,
  refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.5 8a7 7 0 0 1 11.5-1l2 2"/><path d="M17.5 16a7 7 0 0 1-11.5 1l-2-2"/></>,
  parent: <><path d="M12 19V5"/><path d="m7 10 5-5 5 5"/></>,
  save: <><path d="M5 4h12l2 2v14H5Z"/><path d="M8 4v6h8V4"/><path d="M8 20v-6h8v6"/></>,
  close: <><path d="m6 6 12 12"/><path d="M18 6 6 18"/></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
  eyeOff: <><path d="m4 4 16 16"/><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.6 3.2"/><path d="M6.2 6.2C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a9.4 9.4 0 0 0 3-.5"/></>
};

export default function Icon({ name, size = 14 }: Props) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
