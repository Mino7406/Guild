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
            String fileName = monsterName + ".json"; 

            try {
                InputStream is = getClass().getClassLoader().getResourceAsStream(fileName);
                
                if (is == null) {
                    event.reply("❌ 아직 데이터베이스에 등록되지 않은 몬스터입니다: `" + monsterName + "`").queue();
                    return;
                }
                
                JsonObject monsterData = JsonParser.parseReader(new InputStreamReader(is, StandardCharsets.UTF_8)).getAsJsonObject();

                // 새로 추가된 항목들을 가져옵니다.
                String species = monsterData.has("species") ? monsterData.get("species").getAsString() : "불명";
                String threatLevel = monsterData.has("threat_level") ? monsterData.get("threat_level").getAsString() : "불명";
                String habitat = monsterData.has("habitat") ? monsterData.get("habitat").getAsString() : "불명";

                EmbedBuilder embed = new EmbedBuilder();
                embed.setColor(new Color(184, 56, 56));
                
                // 이름 아래에 종, 위험도, 서식지를 깔끔하게 배치합니다.
                embed.setDescription(
                    "# " + monsterName + "\n" +
                    "**[ " + species + " ]**" + "\n\n\n" +
                    "**「위험도」**\n" + threatLevel + "\n" +
                    "**「서식지」**\n" + habitat + "\n\n"
                ); 
                
                embed.setThumbnail(monsterData.get("thumbnail").getAsString());
                embed.addField("**「유효 상태 이상」**", monsterData.get("status").getAsString(), true);
                embed.addField("**「유효 아이템」**", monsterData.get("item").getAsString(), true);
                embed.addField("**「주요 육질표」**", monsterData.get("hitzone").getAsString(), false);
                embed.addField("**「소재 드랍률」**", monsterData.get("drop").getAsString(), false);

                event.replyEmbeds(embed.build()).queue();

            } catch (Exception e) {
                event.reply("⚠️ `" + fileName + "` 파일을 읽는 중 오류가 발생했습니다.").queue();
                e.printStackTrace();
            }
        }
    }
}