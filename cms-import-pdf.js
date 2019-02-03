#! /usr/bin/env node

/*

    THE ORIGINAL WAS IN
    /home/dkz/dev-utpp/museum-1808-massive-upload/upload-batch-85.js

    THIS VERSION is for CMS.
*/


const fs = require('fs');
const path = require('path');
const assert = require('assert');

const Massive = require('massive');
const monitor = require('pg-monitor');
var pdfjsLib = require('pdfjs-dist');

const argv = require('yargs')
  .alias('p','password')
  .alias('f','file')
  .alias('d','dir')
  .alias('a','all')
  .alias('v','verbose').count('verbose')
  .options({
    'commit': {default:true},
  }).argv;

const verbose = argv.verbose;
const password = argv.password || process.env.PGPASSWORD;
const host = argv.host || process.env.PGHOST || 'inhelium.com';
const port = argv.port || process.env.PGPORT || '5432';
const database = argv.database || process.env.PGDATABASE || 'cms-oacs';
const user = argv.user || process.env.PGUSER || 'postgres';
const maxf = argv.maxf || 99999;

argv.dir = argv.dir || process.env.pdfdir;

if (!argv.file && !argv.dir) {
  console.log(`Need folder or pdf/file, ex:
    ./import-pdf.js -d /media/dkz/Seagate/18.11-Museum-rsync-inhelium/pdf-www
    =>exit.`);
  return;
}


if (argv.file) {
  if (argv.dir) {
    console.log('Warning: Both dir and file are specified');
  }
  const fp = path.join(argv.dir, argv.file)
  if (!fs.existsSync(fp)) {
    console.log(`Directory <${fp}> not found`);
    return;
  }
  console.log(`processing file <${fp}>...`);
  every_pdf(fp, argv);
  return;
}

// ==========================================================================

/*
  Here we process an entire folder.
*/


function *walkSync(dir,patterns) {
  const files = fs.readdirSync(dir, 'utf8');
//  console.log(`scanning-dir: <${dir}>`)
  for (const file of files) {
    try {
      const pathToFile = path.join(dir, file);
      if (file.startsWith('.')) continue; // should be an option to --exclude
        const fstat = fs.statSync(pathToFile);
      const isSymbolicLink = fs.statSync(pathToFile).isSymbolicLink();
      if (isSymbolicLink) continue;

      const isDirectory = fs.statSync(pathToFile).isDirectory();
      if (isDirectory) {
        if (file.startsWith('.')) continue;
          yield *walkSync(pathToFile, patterns);
      } else {
        if (file.startsWith('.')) continue;
        let failed = false;
        for (pat of patterns) {
          const regex = new RegExp(pat,'gi');
          if (file.match(regex)) continue;
          failed = true;
          break;
        };
        if (!failed)
        yield pathToFile;
      }
    }
    catch(err) {
      console.log(`ALERT on file:${ path.join(dir, file)} err:`,err)
//      console.log(`ALERT err:`,err)
      continue;
    }
  }
}


const root_folder = argv.dir;
let nfiles =0;

let db;
Massive({
  host,
  port,
  database,
  user,
  password
})
.then(async _db =>{
  db = _db;
  const npages = await main(db);
  console.log(`closing db...`)
  db.pgp.end();
  console.log(`EXIT Ok.`)
})
.catch(err=>{
  console.log(`FATAL-121 err:`,err);
  db.pgp.end();
})




async function main(db) {
  /*
  const db = await Massive({
    host,
    port,
    database,
    user,
    password
  });*/

  const monitor_options = {
    query(e) {
        /* do some of your own processing, if needed */

        monitor.query(e); // monitor the event;
    },
    error(err, e) {
        /* do some of your own processing, if needed */

        monitor.error(err, e); // monitor the event;
    },
    notice(err, e) {
        /* do some of your own processing, if needed */

        monitor.notice(err, e); // monitor the event;
    },
  };
  if (verbose) {
    monitor.attach(db.driverConfig);
    //  monitor.attach(monitor_options);
    console.log(`pg-monitor attached-Ok.`);
  }

  console.log('Massive is ready.');
  if (true || verbose) {
    console.log(`
      host:${host}
      port:${port}
      database:${database}
      user:${user}
      password:${password}
      appInstance:'cms-236393'
      `)
  }
  // ------------------------------------------------------------------------

  const retv1 = await db.query(`
    select * from cms_instances where name = 'cms-236393';
    `,[],{single:true})

  const {package_id, folder_id} = retv1;
  _assert(package_id, retv1, 'Missing package_id')
  _assert(folder_id, retv1, 'Missing folder_id')

  if (verbose) {
    console.log(`found package_id:${package_id} folder_id:${folder_id} retv1:`,retv1)
  }

  if (argv['create-pdf-root']) {
    const retv3 = await db.query(`
      select content_folder__new($1)
      `,[{
        package_id,
        parent_id: folder_id,
        name:'pdf-root', label:`pdf-root for cms-236393`,
        description: 'w/new function'
      }], {single:true})
  }

  // ------------------------------------------------------------------------

  const retv2 = await db.query(`
    select folder_id from cms_folders where name = 'pdf-root' and package_id = $1;
    `,[package_id], {single:true});

  if (!retv2) {
    console.log(`
      pdf-root folder is not found in package_id:${package_id}
      restart the program with option --create-pdf-root
      `);
    program.exit(-1)
  }

  const {folder_id:pdf_root_folder} = retv2;
  _assert(pdf_root_folder, retv2, 'Missing pdf_root_folder')

  // ------------------------------------------------------------------------

/*
  const pdf_root = await db.query(`
    select cms_folder__commit($1)`,[{
      package_id,
      name: '#pdf-root-folder',
      title: '#pdf-root-folder',
      data: {}
    }],{single:true});
*/


  for (const fn of walkSync(root_folder, ['\.pdf$'])) {
    nfiles ++;
    if (nfiles >=maxf) break;

    const doc = await pdfjsLib.getDocument(fn)
    const baseName = path.basename(fn);
    const dirname = path.dirname(fn);
    if (true || verbose)
      console.log(`[${nfiles}] npages:${doc.numPages} <${fn}> `);

    const retv3 = await db.query(`
      select * from cms_revision__commit($1)
      `,[{
      parent_id: pdf_root_folder,
      title: baseName,
      item_subtype: 'pdf_file',
      package_id,
      name: nor_au2(baseName),
      data: {
        dirname, // origin folder - just for infos.
      },
      verbose:1
    }], {single:true});



    if (verbose) console.log(`retv3:`,retv3)
    _assert(retv3, retv3, 'Invalid cr_item1')
    _assert(retv3.cms_revision__commit, retv3, 'Invalid cr_item2')

    const {item_id, revision_id} = retv3.cms_revision__commit;
    _assert(item_id && revision_id, retv3, 'Invalid cr_item')

    for (let pageNo=1; pageNo <=doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const textContent = await page.getTextContent();
      const raw_text = textContent.items
        .map(it => it.str).join(' ')
        .replace(/\s+/g,' ')
        .replace(/\.\.+/g,'.');

      if (argv.commit) {
        try {
//          console.log(`-- page ${pageNo} raw_text:${raw_text.length}`);
          const o = {
            revision_id,
            url:baseName, pageNo,
            raw_text
          };
          const db2 = db.cms;
//          const retv = await db.cms.pdf_page__commit(o);
          const retv = await db.query(`select cms.pdf_page__commit($1)`,[o], {single:true});
//          console.log(`-- page ${pageNo} raw_text:${raw_text.length} retv:`,retv.pdf_page__commit)
          if (retv.error) {
            console.log(`-- pdf ${baseName}##${pageNo} =>retv:`,retv.pdf_page__commit)
          } else {
            if (verbose) {
              console.log(`--SUCCESS pdf_page_commit ${baseName}##${pageNo} revision_id:${retv.pdf_page__commit.revision_id}`)
              console.log(`-- pdf ${baseName}##${pageNo} =>retv:`,retv.pdf_page__commit)
            }
          }
        }
        catch(err) {
          console.log(err)
        }
      }
    }; // each page
  }; // each pdf
  return nfiles;
};


String.prototype.RemoveAccents = function () {
//  var strAccents = strAccents.split('');
 var strAccents = this.split('');
 var strAccentsOut = new Array();
 var strAccentsLen = strAccents.length;
 var accents = 'ÀÁÂÃÄÅàáâãäåÒÓÔÕÕÖØòóôõöøÈÉÊËèéêëðÇçÐÌÍÎÏìíîïÙÚÛÜùúûüÑñŠšŸÿýŽž';
 var accentsOut = "AAAAAAaaaaaaOOOOOOOooooooEEEEeeeeeCcDIIIIiiiiUUUUuuuuNnSsYyyZz";
 for (var y = 0; y < strAccentsLen; y++) {
   if (accents.indexOf(strAccents[y]) != -1) {
     strAccentsOut[y] = accentsOut.substr(accents.indexOf(strAccents[y]), 1);
   } else
     strAccentsOut[y] = strAccents[y];
 }
 strAccentsOut = strAccentsOut.join('');
 return strAccentsOut;
}

/***
main(argv)
.then((npages)=>{
  console.log('done npages:',npages);
  db.pgp.end();
})
.catch (err => {
  console.log(`catching error:`,err)
  throw err
})

***/

function _assert(b, o, err_message) {
  if (!b) {
    console.log(`[${err_message}]_ASSERT=>`,o);
    console.trace(`[${err_message}]_ASSERT`);
    throw {
      message: err_message // {message} to be compatible with other exceptions.
    }
  }
}


function nor_au2(s) {
  // strip accents.
  const h = {};
  const v = s && (''+s).toLowerCase()
  .RemoveAccents()
  .replace(/[\(\)\-\.\']/g,' ')
//  .replace(/[^a-z]/g,' ')
  .replace(/\s+/g,'') // insenstive to spaces, dots, dashes and ().
  .split('')
  .forEach(cc=>{
    h[cc] = h[cc] || 0;
    h[cc] ++;
  })

  const s2 = Object.keys(h).map(cc=>{
    return (h[cc]>1)?`${cc}${h[cc]}`:cc;
  })

//  .filter(it=>(it.length>1));

//  if (v.length>0) return v.join('-');
//  return '*undefined*'
  return s2.join('');
}
