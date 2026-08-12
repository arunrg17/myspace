# Running the API Test Suite on your own laptop

A step-by-step guide written for someone who is **not** a developer. Follow it
top to bottom. You will install three free tools, run a few copy-paste commands,
and end up with the application open in your web browser.

Set aside about 30–40 minutes the first time. After that, starting it again
takes under a minute.

There is nothing to pay for and nothing that touches the internet except
downloading the three tools.

---

## What you are about to build

The application has two halves that become **one program** when you follow this
guide:

- the **engine + server** (the Java part that actually runs your API tests), and
- the **screen** (the web page you click around in).

You will build the screen once, tuck it inside the server, and from then on run
a single thing. When it is running, you open your browser to a local address and
use it — exactly like it will work on the real server later.

```
   Your browser  ───▶   One program running on your laptop
   (localhost)          (the server, with the screen built in)
                                │
                                ▼
                        A folder on your laptop
                        (your test files + results live here)
```

---

## Step 1 — Install the three free tools

Install these in order. Accept the default options in every installer unless a
step below says otherwise.

### 1a. Java 21 (to run the engine and server)

Java is what the engine and server are written in.

- Go to **https://adoptium.net/temurin/releases/** and download **Temurin 21**
  for your system (JDK, not JRE — you need the full kit to build).
  - Windows: choose the `.msi` installer.
  - Mac: choose the `.pkg` installer.
- Run the installer. On Windows, when it asks, tick **"Set JAVA_HOME variable"**
  and **"Add to PATH"** if those options appear.

### 1b. Maven (to assemble the Java program)

Maven takes the Java source code and turns it into a runnable program.

- **Windows (easiest): install Chocolatey first**, then Maven:
  1. Open **PowerShell as Administrator** (right-click → Run as administrator).
  2. Paste this and press Enter:
     ```
     Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
     ```
  3. Close that window, open a **new** PowerShell as Administrator, and run:
     ```
     choco install maven -y
     ```
- **Mac (easiest): install Homebrew first**, then Maven:
  1. Open the **Terminal** app.
  2. Paste this and press Enter, then follow its prompts:
     ```
     /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
     ```
  3. Then run:
     ```
     brew install maven
     ```

### 1c. Node.js 20 (to build the screen)

Node builds the web page part.

- Go to **https://nodejs.org** and download the **LTS** version (labelled "20"
  or higher). Run the installer with default options.

### Check the tools installed correctly

Open a **fresh** command window:
- **Windows**: press Start, type `powershell`, open **Windows PowerShell**.
- **Mac**: open the **Terminal** app.

Type each line below and press Enter. Each should print a version number. If any
says "not recognised" or "command not found", that tool did not install — redo
its step and open a fresh window.

```
java -version
mvn -version
node -version
```

---

## Step 2 — Unzip the three packages

You were given three zip files:

- `api-test-suite-java-v2.13.0.zip`   (the engine)
- `api-test-suite-server-v2.0.0.zip`  (the server)
- `api-test-suite-web-v1.2.0.zip`     (the screen)

Make a folder to work in, and unzip all three **into it** so they sit side by
side. For example, create a folder called `apitest` in your home directory and
unzip so you end up with:

```
apitest/
├── api-test-suite-java-v2.13.0/
├── api-test-suite-server-v2.0.0/
└── api-test-suite-web-v1.2.0/
```

The exact folder names must be kept — later commands use them.

---

## Step 3 — Point your command window at the work folder

In your command window, move into the folder you just made. Replace the path if
you put it somewhere else.

- **Windows**:
  ```
  cd $HOME\apitest
  ```
- **Mac**:
  ```
  cd ~/apitest
  ```

Everything from here runs from this `apitest` folder.

---

## Step 4 — Build the engine

This prepares the engine so the server can include it.

```
cd api-test-suite-java-v2.13.0
mvn install -DskipTests
cd ..
```

The first time, Maven downloads what it needs — this can take several minutes
and prints a lot of text. When it finishes you should see **BUILD SUCCESS** near
the bottom. If you see BUILD FAILURE, jump to **Troubleshooting** below.

---

## Step 5 — Build the screen and tuck it into the server

This builds the web page and copies it inside the server, so the server can show
it. Run these one block at a time.

**5a. Build the screen:**
```
cd api-test-suite-web-v1.2.0
npm ci
npm run build
cd ..
```
`npm ci` downloads the screen's building blocks (a few minutes the first time).
`npm run build` produces a `dist` folder inside `api-test-suite-web-v1.2.0`.

**5b. Copy the built screen into the server.** The server shows any web files it
finds in a folder called `static`. These commands create that folder and copy
the screen in.

- **Windows**:
  ```
  New-Item -ItemType Directory -Force -Path "api-test-suite-server-v2.0.0\src\main\resources\static"
  Copy-Item -Recurse -Force "api-test-suite-web-v1.2.0\dist\*" "api-test-suite-server-v2.0.0\src\main\resources\static\"
  ```
- **Mac**:
  ```
  mkdir -p api-test-suite-server-v2.0.0/src/main/resources/static
  cp -R api-test-suite-web-v1.2.0/dist/* api-test-suite-server-v2.0.0/src/main/resources/static/
  ```

---

## Step 6 — Build the server (now with the screen inside it)

```
cd api-test-suite-server-v2.0.0
mvn package -DskipTests
cd ..
```

Again, wait for **BUILD SUCCESS**. This creates the finished program at:

```
api-test-suite-server-v2.0.0/target/api-test-suite-server-2.0.0.jar
```

That single file is the whole application — engine, server, and screen together.

---

## Step 7 — Make a workspace folder

This is where your uploaded test files and results will live. Make an empty
folder for it:

- **Windows**:
  ```
  New-Item -ItemType Directory -Force -Path "$HOME\apitest\workspace"
  ```
- **Mac**:
  ```
  mkdir -p ~/apitest/workspace
  ```

Optional but handy: copy the starter Excel template in, so the app's "Download
blank template" button works.

- **Windows**:
  ```
  New-Item -ItemType Directory -Force -Path "$HOME\apitest\workspace\config"
  Copy-Item "api-test-suite-server-v2.0.0\workspace-seed\config\test_suite_template.xlsx" "$HOME\apitest\workspace\config\"
  ```
- **Mac**:
  ```
  mkdir -p ~/apitest/workspace/config
  cp api-test-suite-server-v2.0.0/workspace-seed/config/test_suite_template.xlsx ~/apitest/workspace/config/
  ```

---

## Step 8 — Start the application

Now run it. This command starts the program and points it at your workspace
folder.

- **Windows**:
  ```
  java -jar api-test-suite-server-v2.0.0\target\api-test-suite-server-2.0.0.jar --apitest.workspace=$HOME\apitest\workspace
  ```
- **Mac**:
  ```
  java -jar api-test-suite-server-v2.0.0/target/api-test-suite-server-2.0.0.jar --apitest.workspace=~/apitest/workspace
  ```

You will see log lines scroll by. When you see a line mentioning **"Started
ApiTestServerApplication"** (usually within 10–20 seconds), it is ready.

**Leave this window open** — closing it stops the application.

---

## Step 9 — Open it in your browser

Open your web browser and go to:

```
http://localhost:8080
```

The screen loads and you are running the full application on your laptop. Upload
a workbook, run it, view the report, save it as PDF — all of it works exactly as
it will on the server.

---

## Stopping and starting again

- **To stop it:** click the command window running it and press **Ctrl + C**
  (on Mac, also Ctrl + C). Or just close that window.
- **To start it again later:** you do **not** repeat the whole guide. Open a
  command window, go to the `apitest` folder (Step 3), and run the single
  command from **Step 8**. That is it.

You only redo Steps 4–6 if you are given a new version of the packages.

---

## Troubleshooting

**"java" / "mvn" / "node" is not recognised.**
The tool did not install, or you did not open a fresh window after installing.
Close every command window, open a new one, and check again with the version
commands in Step 1. On Windows, reinstalling Temurin with "Add to PATH" ticked
fixes most Java cases.

**BUILD FAILURE during Step 4 or 6.**
Almost always the internet was blocked while Maven tried to download something,
or a company proxy is in the way. If you are on a corporate laptop, your IT team
may need to point Maven at the internal "Artifactory" mirror. Copy the last
20–30 red lines and send them to whoever manages your build tools — that error
text tells them exactly what to allow.

**Port 8080 is already in use.**
Something else on your laptop is using that address. Start the app on a different
port by adding `--server.port=8090` to the end of the Step 8 command, then open
`http://localhost:8090` instead.

**The page at localhost:8080 is blank or "can't be reached".**
Make sure the Step 8 window is still open and showing no error, and that you saw
the "Started ApiTestServerApplication" line. Give it another 10 seconds and
refresh.

**It runs but can't reach the APIs I'm testing.**
The app calls the APIs from *your laptop*, so your laptop must be able to reach
them — same network, VPN on if needed. This is about your network access, not
the app.

---

## Quick reference (once everything is installed)

Start it:
```
cd ~/apitest        (Mac)   /   cd $HOME\apitest   (Windows)
java -jar api-test-suite-server-v2.0.0/target/api-test-suite-server-2.0.0.jar --apitest.workspace=~/apitest/workspace
```
Open: **http://localhost:8080**
Stop: **Ctrl + C** in that window.

---

## Appendix — the "live editing" way (only if a developer helps you)

The guide above builds the screen into the server, which is the simplest way to
try it. Developers sometimes run the two halves separately so screen changes
appear instantly: start the server with `mvn spring-boot:run` in the server
folder, and in a second window run `npm run dev` in the web folder, then open
`http://localhost:5173`. The web page automatically forwards its `/api` calls to
the server on 8080. You do **not** need this to evaluate the tool — it is only
useful if someone is actively changing the screen's code.
