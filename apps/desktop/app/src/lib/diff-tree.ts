export type DiffTreeFile<T> = { type: "file"; name: string; path: string; file: T };
export type DiffTreeFolder<T> = { type: "folder"; name: string; path: string; added: number; removed: number; children: DiffTreeNode<T>[] };
export type DiffTreeNode<T> = DiffTreeFile<T> | DiffTreeFolder<T>;

type Counted = { path: string; added: number; removed: number };

/** Nested folders with summed counts. A folder holding only one folder is merged into it ("src/components"). */
export function buildDiffTree<T extends Counted>(files: T[]): DiffTreeNode<T>[] {
  const root: DiffTreeFolder<T> = { type: "folder", name: "", path: "", added: 0, removed: 0, children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let folder = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = folder.children.find((child): child is DiffTreeFolder<T> => child.type === "folder" && child.path === path);
      if (!next) {
        next = { type: "folder", name: parts[i], path, added: 0, removed: 0, children: [] };
        folder.children.push(next);
      }
      next.added += file.added;
      next.removed += file.removed;
      folder = next;
    }
    folder.children.push({ type: "file", name: parts[parts.length - 1], path: file.path, file });
  }
  return finish(root.children);
}

function finish<T>(nodes: DiffTreeNode<T>[]): DiffTreeNode<T>[] {
  const sorted = nodes
    .map((node): DiffTreeNode<T> => {
      if (node.type === "file") return node;
      let folder = node;
      while (folder.children.length === 1 && folder.children[0].type === "folder") {
        const only = folder.children[0];
        folder = { ...only, name: `${folder.name}/${only.name}` };
      }
      return { ...folder, children: finish(folder.children) };
    })
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
  return sorted;
}
