/** Shapes behind the Drives page. */

export interface DriveInfo {
  root: string;
  totalBytes: number;
  freeBytes: number;
  /** The drive Windows is installed on. */
  system: boolean;
}

export interface DriveFolder {
  path: string;
  name: string;
  bytes: number;
  files: number;
  /** Windows, installers or the user profile own it; it can be looked at but never deleted here. */
  protected: boolean;
}

/** Either a job to wait on, or the answer straight from the cache. */
export type DriveScanStart =
{jobId: string;} |
{folders: DriveFolder[];looseBytes: number;looseFiles: number;measuredAt: number;bytes: number;};

/** What a move would do, before it does it. */
export interface MovePlan {
  ok: boolean;
  message?: string;
  source?: string;
  destination?: string;
  sameDrive?: boolean;
  /** Bytes and files that travel: everything except build output. */
  carriedBytes?: number;
  carriedFiles?: number;
  /** Build output that stays behind and is deleted with the original. */
  leftBehindBytes?: number;
  totalBytes?: number;
  freeBytes?: number | null;
  excluded?: string[];
}
