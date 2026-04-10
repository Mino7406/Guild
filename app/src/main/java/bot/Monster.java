package bot;

import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.interactions.commands.OptionMapping;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.awt.Color;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class Monster extends ListenerAdapter {
    
    @Override
    public void onSlashCommandInteraction(SlashCommandInteractionEvent event) {
        if (event.getName().equals("몬스터")) {
            
            OptionMapping option = event.getOption("이름");
            if (option == null) {
                event.reply("몬스터 이름을 입력해주세요!").queue();
                return;
            }
            
            String monsterName = option.getAsString();
            
            // 핵심: 사용자가 입력한 이름 뒤에 ".json"을 붙여서 파일 이름을 만듭니다.
            String fileName = monsterName + ".json"; 

            try {
                // 1. resources 폴더에서 해당 이름의 파일을 찾습니다.
                InputStream is = getClass().getClassLoader().getResourceAsStream(fileName);
                
                if (is == null) {
                    // 파일이 없다면 아직 등록 안 한 몬스터입니다.
                    event.reply("❌ 아직 데이터베이스에 등록되지 않은 몬스터입니다: `" + monsterName + "`\n( `" + fileName + "` 파일을 찾을 수 없습니다 )").queue();
                    return;
                }
                
                // 2. 파일을 찾았다면 JSON으로 읽어옵니다.
                JsonObject monsterData = JsonParser.parseReader(new InputStreamReader(is, StandardCharsets.UTF_8)).getAsJsonObject();

                // 3. 임베드 만들기
                EmbedBuilder embed = new EmbedBuilder();
                embed.setColor(new Color(184, 56, 56));
                embed.setDescription("# " + monsterName + "\n"); 
                
                // JSON 파일 안의 내용을 항목별로 가져옵니다.
                embed.setThumbnail(monsterData.get("thumbnail").getAsString());
                embed.addField("상태이상", monsterData.get("status").getAsString(), true);
                embed.addField("함정 여부", monsterData.get("trap").getAsString(), true);
                embed.addField("주요 육질표", monsterData.get("hitzone").getAsString(), false);
                embed.addField("주요 소재 드랍률", monsterData.get("drop").getAsString(), false);

                // 4. 전송
                event.replyEmbeds(embed.build()).queue();

            } catch (Exception e) {
                // 파일 안에 오타나 쉼표 빼먹음 등의 문법 에러가 났을 때
                event.reply("⚠️ `" + fileName + "` 파일을 읽는 중 오류가 발생했습니다. 쉼표(,)나 따옴표(\")가 제대로 있는지 확인해주세요.").queue();
                e.printStackTrace();
            }
        }
    }
}