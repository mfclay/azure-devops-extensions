/**
 * Writing an artefact to disk and filing it as a build attachment.
 *
 * The attachment is decision **B2**'s transport: one
 * `getAttachments(project, buildId, type)` call returns every stage's attachment
 * for a run, and that single call is how the tab aggregates nine stacks without
 * knowing they exist. The `type` string is the join key and the `name` is the
 * stack id — both are contract, not convention.
 *
 * **This is what decision D6 protects.** Setting
 * `restrictions.commands.mode: restricted` in `task.json` — which Microsoft
 * recommends for production tasks — permits ten logging commands, and
 * `addattachment` is not among them. It would disable the mechanism the entire
 * design rests on, silently, with the task still reporting success.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface AttachDeps {
  /** `tl.addAttachment`, which escapes the logging command's properties properly. */
  addAttachment: (type: string, name: string, filePath: string) => void;
  log: (message: string) => void;
}

export interface Artefact {
  /** Attachment type — the tab's join key. */
  type: string;
  /** Attachment name — the stack id. */
  name: string;
  /** File name within the output directory. */
  fileName: string;
  content: string;
}

/**
 * Write, then attach. Never throws.
 *
 * A failure to attach must not take down a run that has already produced a
 * result, and it must not stop the *next* attachment either — the sidecar is
 * written after the payload precisely so that a stage whose payload failed still
 * says what happened. Returns whether it worked so the caller can say so.
 */
export async function writeAndAttach(
  deps: AttachDeps,
  outputPath: string,
  artefact: Artefact,
): Promise<boolean> {
  const filePath = path.join(outputPath, artefact.fileName);
  try {
    await fs.mkdir(outputPath, { recursive: true });
    await fs.writeFile(filePath, artefact.content, 'utf8');
  } catch (error) {
    deps.log(`Could not write ${filePath}: ${String(error)}`);
    return false;
  }
  try {
    deps.addAttachment(artefact.type, artefact.name, filePath);
    deps.log(`Attached ${artefact.type} as "${artefact.name}" (${filePath}).`);
    return true;
  } catch (error) {
    deps.log(`Could not attach ${filePath} as ${artefact.type}: ${String(error)}`);
    return false;
  }
}
