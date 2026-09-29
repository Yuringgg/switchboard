import {
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Presentation,
  Video,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import {
  buildFolders,
  formatSize,
  itemsIn,
  type Folder,
  type LibraryItem,
} from '@/lib/files';
import { LABEL } from '@/lib/ui';
import { cn } from '@/lib/utils';

/**
 * The Files screen — Ms. Maria's research task 5.
 *
 * Folders on the left, what is in the chosen one on the right; on a phone the
 * folders become one sideways-scrolling row above the list, so the page itself
 * never scrolls sideways. A component rather than markup in the route so
 * `/preview?screen=files` renders exactly this over fixtures.
 *
 * ⚠ Opening a file goes through `/api/files/[id]`, which checks the file is
 * the reader's and hands back a five-minute link. Nothing here links to
 * storage directly, and nothing is prefetched: these are other people's
 * documents and the reader has not asked for them yet (ADR-018's rule).
 */
export function FileLibrary({
  items,
  folderKey,
  basePath = '/files',
}: {
  items: LibraryItem[];
  folderKey: string;
  basePath?: string;
}) {
  const groups = buildFolders(items);
  const all = [...groups.top, ...groups.people, ...groups.organisations];
  const active = all.find((f) => f.key === folderKey) ?? groups.top[0]!;
  const shown = itemsIn(items, active.key);

  return (
    <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
      <nav aria-label="Folders" className="min-w-0">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:block md:space-y-5 md:overflow-visible md:px-0">
          <FolderGroup folders={groups.top} active={active.key} basePath={basePath} />
          {groups.people.length > 0 && (
            <FolderGroup
              title="People"
              folders={groups.people}
              active={active.key}
              basePath={basePath}
            />
          )}
          {groups.organisations.length > 0 && (
            <FolderGroup
              title="Companies"
              folders={groups.organisations}
              active={active.key}
              basePath={basePath}
            />
          )}
        </div>
      </nav>

      <section aria-label={active.label} className="min-w-0">
        <p className={cn(LABEL, 'mb-3')}>
          {active.label} · {shown.length} item{shown.length === 1 ? '' : 's'}
        </p>
        {shown.length === 0 ? (
          <p className="border-t border-border py-10 text-center text-note text-muted-foreground">
            {active.key === 'meetings'
              ? 'No meetings recorded yet. A transcript lands here when a notetaker you sent finishes.'
              : 'Nothing in this folder.'}
          </p>
        ) : (
          <FileRows items={shown} />
        )}
      </section>
    </div>
  );
}

function FolderGroup({
  title,
  folders,
  active,
  basePath,
}: {
  title?: string;
  folders: Folder[];
  active: string;
  basePath: string;
}) {
  return (
    <div className="contents md:block">
      {title && <p className={cn(LABEL, 'mb-1.5 hidden px-2 md:block')}>{title}</p>}
      <ul className="contents md:block md:space-y-0.5">
        {folders.map((folder) => {
          const selected = folder.key === active;
          return (
            <li key={folder.key} className="shrink-0">
              <Link
                href={`${basePath}${basePath.includes('?') ? '&' : '?'}folder=${encodeURIComponent(folder.key)}`}
                aria-current={selected ? 'page' : undefined}
                className={cn(
                  'focus-ring flex items-center gap-2 rounded-md px-2 py-1.5 text-row whitespace-nowrap transition-colors md:whitespace-normal',
                  selected
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <span className="min-w-0 truncate md:flex-1">{folder.label}</span>
                <span className="font-mono text-label text-muted-foreground">{folder.count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The rows alone — also used by a contact's Files section. */
export function FileRows({ items }: { items: LibraryItem[] }) {
  return (
    <ul className="border-t border-border">
      {items.map((item) =>
        item.kind === 'transcript' ? (
          <li key={`t-${item.messageId}`} className="flex items-start gap-3 border-b border-border px-1 py-3">
            <FileIcon icon={Video} />
            <span className="min-w-0 flex-1">
              <Link
                href={`/messages/${item.messageId}`}
                prefetch={false}
                className="focus-ring block truncate rounded text-row font-medium hover:underline"
              >
                {item.title}
              </Link>
              <span className={cn(LABEL, 'mt-0.5 block normal-case')}>Meeting transcript</span>
            </span>
            <span className={cn(LABEL, 'shrink-0 normal-case')}>{formatDay(item.sentAt)}</span>
          </li>
        ) : (
          <li key={item.id} className="flex items-start gap-3 border-b border-border px-1 py-3">
            <FileIcon icon={iconFor(item.filename, item.mimeType)} />
            <span className="min-w-0 flex-1">
              {/* A plain link, new tab: the route redirects to the file itself. */}
              <a
                href={`/api/files/${item.id}`}
                target="_blank"
                rel="noopener"
                className="focus-ring block truncate rounded text-row font-medium hover:underline"
              >
                {item.filename}
              </a>
              {/* Separated by dots in the markup, not by gap alone: without them
                  "47 KB from Maria Santos Delivery schedule" reads as one phrase. */}
              <span className={cn(LABEL, 'mt-0.5 flex flex-wrap gap-x-1.5 normal-case')}>
                <span>{typeLabel(item.filename, item.mimeType)}</span>
                {item.sizeBytes !== null && (
                  <>
                    <Dot />
                    <span>{formatSize(item.sizeBytes)}</span>
                  </>
                )}
                <Dot />
                <span>
                  {item.direction === 'outbound'
                    ? 'sent by you'
                    : `from ${item.contactName ?? 'unknown sender'}`}
                </span>
                <Dot />
                <Link
                  href={`/messages/${item.messageId}`}
                  prefetch={false}
                  className="focus-ring min-w-0 max-w-full truncate rounded underline underline-offset-2"
                >
                  {item.subject?.trim() || 'the message'}
                </Link>
              </span>
            </span>
            <span className={cn(LABEL, 'shrink-0 normal-case')}>{formatDay(item.sentAt)}</span>
          </li>
        ),
      )}
    </ul>
  );
}

/** Empty library: says what will appear and what is left out on purpose. */
export function FilesEmpty() {
  return (
    <div className="border-t border-border py-12 text-center">
      <FolderOpen className="mx-auto size-5 text-faint" aria-hidden />
      <p className="mt-3 text-row font-medium">No files yet</p>
      <p className="mx-auto mt-1 max-w-[52ch] text-note text-muted-foreground">
        Documents attached to your email are saved here on their own, a couple of minutes after
        they arrive, and filed by who sent them. Logos, signatures and calendar invites are left
        out.
      </p>
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-faint">
      ·
    </span>
  );
}

function FileIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-accent text-muted-foreground"
    >
      <Icon className="size-3.5" />
    </span>
  );
}

function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(filename);
  return match ? match[1]!.toLowerCase() : '';
}

function iconFor(filename: string, mimeType: string | null): LucideIcon {
  const ext = extensionOf(filename);
  const type = (mimeType ?? '').toLowerCase();
  if (type.startsWith('image/')) return FileImage;
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return FileSpreadsheet;
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return Presentation;
  if (['zip', 'rar', '7z', 'gz'].includes(ext)) return FileArchive;
  if (['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext) || type === 'application/pdf') {
    return FileText;
  }
  return File;
}

/** "PDF", "XLSX", "Image" — the kind of file, in one word. */
function typeLabel(filename: string, mimeType: string | null): string {
  const ext = extensionOf(filename);
  if (ext) return ext.toUpperCase();
  if ((mimeType ?? '').startsWith('image/')) return 'Image';
  return 'File';
}

/** PH is UTC+8 with no DST, so a fixed zone is correct rather than a shortcut. */
function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}
