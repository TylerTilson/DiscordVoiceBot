const Discord = require('discord.js');
const client = new Discord.Client();

const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra')
const mergeStream = require('merge-stream');
const config = require('./config.json');

class Readable extends require('stream').Readable { _read() {} }

let recording = false;

let currently_recording = {};

let mp3Paths = [];

const silence_buffer = new Uint8Array(3840);


function bufferToStream(buffer) {  
    let stream = new Readable();
    stream.push(buffer);
    return stream;
}


const generateSilentData = async(silentStream, memberID) => { 
    while(recording) {
        if (!currently_recording[memberID]) {
            silentStream.push(silence_buffer);
        }
        await new Promise(r => setTimeout(r, 20));
    } 
    return "done"; 
}

function generateOutputFile(channelID, memberID) {
    const dir = `./recordings/${channelID}/${memberID}`;
    fs.ensureDirSync(dir);
    const fileName = `${dir}/${getFileName()}.mp3`;
    return fs.createWriteStream(fileName);
}


function getFileName() {
    let today = new Date();
    let dd = today.getDate();
    let mm = today.getMonth() + 1;
    let hours = today.getHours();
    let minutes = today.getMinutes();
    let seconds = today.getSeconds();
    let yyyy = today.getFullYear();
    if (dd < 10) dd = '0' + dd 
    if (mm < 10) mm = '0' + mm
    return yyyy + '-' + mm + '-' + dd + '-' + hours + '-' + minutes + '-' + seconds;
}


client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('message', async message => {
  if (!message.guild) return;

  if (message.content === config.prefix + config.record_command) {
    if (recording) {
        message.reply("bot is already recording");
        return
    }
    if (message.member.voice.channel) {
        recording = true;
        const connection = await message.member.voice.channel.join();
        const dispatcher = connection.play('./audio.mp3');

        connection.on('speaking', (user, speaking) => {
            if (speaking.has('SPEAKING')) {
                currently_recording[user.id] = true;
            } else {
                currently_recording[user.id] = false;
            }
        })


        let members = Array.from(message.member.voice.channel.members.values());
        members.forEach((member) => {
            if (member.id != client.user.id) {
                let memberStream = connection.receiver.createStream(member, {mode : 'pcm', end : 'manual'})

                let outputFile = generateOutputFile(message.member.voice.channel.id, member.id);
                mp3Paths.push(outputFile.path);

                silence_stream = bufferToStream(new Uint8Array(0));
                generateSilentData(silence_stream, member.id).then(data => console.log(data));
                let combinedStream = mergeStream(silence_stream, memberStream);

                /*
                combinedStream.on('data', (chunk) => {
                    console.log(chunk);
                });
                */

                ffmpeg(combinedStream)
                    .inputFormat('s32le')
                    .audioFrequency(48000)
                    .audioChannels(2)
                    .on('error', (error) => {console.log(error)})
                    .audioCodec('libmp3lame')
                    .format('mp3')
                    .pipe(outputFile)
            }
        })
    } else {
      message.reply('You need to join a voice channel first!');
    }
  }

  if (message.content === config.prefix + config.stop_command) {
    let currentVoiceChannel = message.member.voice.channel;
    if (currentVoiceChannel) {
        recording = false;
        currentVoiceChannel.leave();

        let mergedOutputFolder = './recordings/' + message.member.voice.channel.id + '/merged/';
        fs.ensureDirSync(mergedOutputFolder);
        let file_name = getFileName() + '.mp3';
        let mergedOutputFile = mergedOutputFolder + file_name;

        let download_path = message.member.voice.channel.id + '/merged/'+  file_name;

        let mixedOutput = new ffmpeg();
        mp3Paths.forEach((mp3Path) => {
            mixedOutput.addInput(mp3Path);
        })
        //mixedOutput.complexFilter('amix=inputs=2:duration=longest');
        mixedOutput.complexFilter('amix=inputs=' + mp3Paths.length + ':duration=longest');
        mixedOutput.saveToFile(mergedOutputFile);

        message.channel.send('Link to full recording session:' + '\n' + 'http://server.ip.address/' + download_path);

    } else {
      message.reply('You need to join a voice channel first!');
    }
  } else {
    if (message.content.split(/\r\n|\r|\n/).length > config.line_length_limit && config.channel_name_log.includes(message.channel.name)) {
        file = `./recordings/${'text_logs'}/${message.member.id}/logs.txt`;
        fs.ensureFileSync(file);
        fs.appendFileSync(file, 'Channel: ' + message.channel.name + '\n' + message.createdAt + '\n' + message.content + '\n\n');
  
        let date = getFileName().split('-');
        let tmp_file_name = date[0] + date[1] + date[2];
        let daily_file = `./recordings/${'text_logs'}/${tmp_file_name}.txt`;
        fs.ensureFileSync(daily_file);
        fs.appendFileSync(daily_file, 'Channel: ' + message.channel.name + '\n' + message.createdAt + '\n' + message.content + '\n\n');
      }
  }
});

client.login(config.token);
