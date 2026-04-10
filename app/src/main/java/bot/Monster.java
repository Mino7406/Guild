package bot;

import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.entities.emoji.Emoji;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.events.interaction.component.ButtonInteractionEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.interactions.commands.OptionMapping;
import net.dv8tion.jda.api.interactions.components.buttons.Button;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.awt.Color;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public class Monster extends ListenerAdapter {

    private JsonObject getMonsterData(String monsterName) {
        try {
            String fileName = monsterName + ".json";
            InputStream is = getClass().getClassLoader().getResourceAsStream(fileName);
            if (is == null) return null;
            return JsonParser.parseReader(new InputStreamReader(is, StandardCharsets.UTF_8)).getAsJsonObject();
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    private List<Button> getTabButtons(String currentTab, String monsterName) {
        List<Button> buttons = new ArrayList<>();

        if (!currentTab.equals("basic")) 
            buttons.add(Button.secondary("basic_" + monsterName, "기본 정보").withEmoji(Emoji.fromFormatted("<:Info_4:1492145251941482697>")));
        
        if (!currentTab.equals("hitzone")) 
            buttons.add(Button.primary("hitzone_" + monsterName, "육질 정보").withEmoji(Emoji.fromFormatted("<:Info_2:1492145248795758602>")));
        
        if (!currentTab.equals("drop")) 
            buttons.add(Button.success("drop_" + monsterName, "소재 정보").withEmoji(Emoji.fromFormatted("<:Info_1:1492145247327617185>")));
        
        if (!currentTab.equals("status")) 
            buttons.add(Button.danger("status_" + monsterName, "상태이상 정보").withEmoji(Emoji.fromFormatted("<:Info_3:1492145250192331015>")));

        return buttons;
    }

    @Override
    public void onSlashCommandInteraction(SlashCommandInteractionEvent event) {
        if (event.getName().equals("몬스터")) {
            OptionMapping option = event.getOption("이름");
            if (option == null) {
                event.reply("몬스터 이름을 입력해주세요!").queue();
                return;
            }
            
            String monsterName = option.getAsString();
            JsonObject monsterData = getMonsterData(monsterName);

            if (monsterData == null) {
                event.reply("❌ 아직 데이터베이스에 등록되지 않은 몬스터입니다: `" + monsterName + "`").queue();
                return;
            }

            // 💡 기본 정보 출력 (최초 검색 시)
            sendBasicPage(event, null, monsterName, monsterData, false);
        }
    }

    @Override
    public void onButtonInteraction(ButtonInteractionEvent event) {
        String[] parts = event.getComponentId().split("_");
        if (parts.length < 2) return;

        String action = parts[0];       
        String monsterName = parts[1];  

        JsonObject monsterData = getMonsterData(monsterName);
        if (monsterData == null) {
            event.reply("데이터를 불러올 수 없습니다.").setEphemeral(true).queue();
            return;
        }

        EmbedBuilder embed = new EmbedBuilder();
        embed.setColor(new Color(184, 56, 56));
        embed.setThumbnail(monsterData.get("thumbnail").getAsString());

        switch (action) {
            case "basic":
                // 💡 기본 정보 탭 클릭 시
                sendBasicPage(null, event, monsterName, monsterData, true);
                return;

            case "hitzone":
                embed.setDescription("# " + monsterName + "\n\n" + monsterData.get("hitzone").getAsString());
                break;

            case "drop":
                embed.setDescription("# " + monsterName + "\n\n" + monsterData.get("drop").getAsString());
                break;

            case "status":
                embed.setDescription("# " + monsterName + "\n\n");
                embed.addField("**《유효 상태 이상》**", monsterData.get("status").getAsString(), true);
                embed.addField("**《유효 아이템》**", monsterData.get("item").getAsString(), true);
                break;
        }

        event.editMessageEmbeds(embed.build())
             .setActionRow(getTabButtons(action, monsterName))
             .queue();
    }

    // 💡 [공통 메서드] 기본 정보 페이지를 구성하고 전송/수정합니다.
    private void sendBasicPage(SlashCommandInteractionEvent slashEvent, ButtonInteractionEvent buttonEvent, String monsterName, JsonObject monsterData, boolean isEdit) {
        EmbedBuilder embed = new EmbedBuilder();
        embed.setColor(new Color(184, 56, 56));
        embed.setThumbnail(monsterData.get("thumbnail").getAsString());

        String species = monsterData.get("species").getAsString();
        String threatLevel = monsterData.get("threat_level").getAsString();
        String habitat = monsterData.get("habitat").getAsString();
        
        // 💡 JSON의 info 필드를 가져오며, 백틱 스타일이 이미 JSON에 포함되어 있으므로 그대로 출력합니다.
        String info = monsterData.has("info") ? monsterData.get("info").getAsString() : "정보가 없습니다.";

        embed.setDescription(
            "# " + monsterName + "\n" +
            "**【 " + species + " 】**\n\n\n" +
            "**《위험도》**\n" + threatLevel + "\n" +
            "**《서식지》**\n" + habitat + "\n" +
            "**《설명》**\n" + info + "\n\n" +
            "💡 **아래 버튼을 눌러 상세 정보를 확인하세요!**"
        );

        if (isEdit) {
            buttonEvent.editMessageEmbeds(embed.build())
                       .setActionRow(getTabButtons("basic", monsterName))
                       .queue();
        } else {
            slashEvent.replyEmbeds(embed.build())
                      .addActionRow(getTabButtons("basic", monsterName))
                      .queue();
        }
    }
}