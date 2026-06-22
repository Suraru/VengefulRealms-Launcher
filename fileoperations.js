import * as fs from 'fs';
import * as path from 'path';

const userDataPath = app.getPath('appData');
const igxDirectoryPath = path.join(userDataPath, 'Project_Name');
const parentDirectoryPath = path.join(igxDirectoryPath, 'Folder_Name');

function ensureICSDirectory(): void {
  if (!fs.existsSync(parentDirectoryPath)) {
    fs.mkdirSync(parentDirectoryPath, { recursive: true });
    console.log('Directory created successfully:', parentDirectoryPath);
  } else {
    console.log('Directory already exists:', parentDirectoryPath);
  }
}

// Ensure directory and file existence
function ensureFileExistence(filePath: string): void {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({}), 'utf-8');
  }
}


export function writeData(data: any): void {
  const timestamp = Date.now().toString();
  const directoryPath = path.join(parentDirectoryPath, timestamp);
  const filePath = path.join(directoryPath, 'output.json');
  ensureFileExistence(filePath);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}


// Read data from a file
export function readData(timestamp: string): any {
  ensureICSDirectory();
  const filePath = path.join(parentDirectoryPath, timestamp, 'output.json');
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } else {
    return JSON.stringify({});
  }
}





//Metadraconis Implementation


export function writeFilesFromFolderToDest(from_path: string, to_path: string): void {
}

export function deleteFilesInFolder(path: string, prefix_filter: string, suffix_filter: string): void {
}

export function verifyModFiles(): void {
}

export function grabModsFromFileserver(fileserver_cfg: string, vgrStagingFolder: string): void {
}

export function deployModsToFileserver(fileserver_cfg: string, devStagingFolder: string): void {
}